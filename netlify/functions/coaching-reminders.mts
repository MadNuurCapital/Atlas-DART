import {
  adminClient,
  appUrl,
  authoriseRun,
  sgHour,
  withinHourWindow,
} from "./lib/reminders.mts";
import { configureVapid, deliver, loadDevices } from "./lib/push.mts";

/**
 * Coaching reminders: the evening before, and the morning of.
 *
 * The third notification - the one sent the moment a session is booked - is
 * not here. That one goes out from the server action itself, because there is
 * no point waiting up to a day to tell someone about a meeting that might be
 * tomorrow.
 *
 * Runs twice a day rather than hourly. Unlike a missing DART, coaching is not
 * something the person is failing to do, so nagging would be the wrong shape
 * entirely - two notifications per session is plenty to prevent a no-show.
 *
 *   00:00 UTC = 08:00 Singapore - the morning of
 *   11:00 UTC = 19:00 Singapore - the evening before
 */

const SG_TIME_ZONE = "Asia/Singapore";

/** The Singapore calendar date at an instant. */
function sgDate(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SG_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function sgTimeLabel(at: Date): string {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: SG_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(at);
}

/** Tomorrow, in the Singapore calendar. */
function nextDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1, 12)).toISOString().slice(0, 10);
}

type Kind = "day_before" | "morning_of";

/**
 * The two slots this runs in, as Singapore hours, both ends inclusive.
 *
 * The schedule aims at 08:00 and 19:00. The windows are wider than that so an
 * ordinarily late run still lands, but narrow enough that a badly late one
 * does not quietly turn into the other reminder.
 *
 * That is not hypothetical. The 08:00 run once arrived at 17:47 and, because
 * the kind was chosen by asking whether the hour was before midday, sent the
 * EVENING-BEFORE reminder for the NEXT day instead of the morning-of reminder
 * for that day. Nobody noticed only because no session was booked.
 */
const MORNING_FROM = 6;
const MORNING_TO = 11;
const EVENING_FROM = 17;
const EVENING_TO = 22;

/** Which reminder this hour is for, or null if it is for neither. */
function kindForHour(hour: number): Kind | null {
  if (withinHourWindow(hour, MORNING_FROM, MORNING_TO)) return "morning_of";
  if (withinHourWindow(hour, EVENING_FROM, EVENING_TO)) return "day_before";
  return null;
}

export default async function handler(request: Request) {
  const url = new URL(request.url);
  if (!authoriseRun(request)) {
    return new Response("Unauthorised", { status: 401 });
  }

  const now = new Date();
  const hour = Number(url.searchParams.get("hour") ?? sgHour(now));
  const dryRun = url.searchParams.get("dryRun") === "true";

  // Which reminder is this? An explicit ?kind= wins, for a manual run. There
  // is otherwise no way to tell the two apart from the outside: both slots
  // share one cron expression, so the caller cannot say which one fired.
  const kind = (url.searchParams.get("kind") as Kind | null) ?? kindForHour(hour);

  if (kind === null) {
    console.log(
      "[coaching-reminders] hour=%d belongs to neither slot - sending nothing",
      hour,
    );
    return Response.json({
      hour,
      skipped: "outside both coaching windows",
      windows: {
        morning_of: `${MORNING_FROM}:00-${MORNING_TO}:59`,
        day_before: `${EVENING_FROM}:00-${EVENING_TO}:59`,
      },
      sessions: 0,
      sent: 0,
    });
  }

  const today = sgDate(now);
  const target =
    url.searchParams.get("date") ??
    (kind === "morning_of" ? today : nextDay(today));

  console.log(
    "[coaching-reminders] start kind=%s date=%s hour=%d dryRun=%s",
    kind,
    target,
    hour,
    dryRun,
  );

  try {
    configureVapid();
    const base = appUrl();
    const supabase = adminClient();

    // Everything scheduled on the target Singapore day. Compared as instants
    // against the day's bounds rather than by casting to a date, so the
    // timezone is applied once, here, and not left to Postgres' session zone.
    const dayStart = new Date(`${target}T00:00:00+08:00`).toISOString();
    const dayEnd = new Date(`${target}T23:59:59.999+08:00`).toISOString();

    const { data: sessions, error } = await supabase
      .from("coaching_sessions")
      .select("id, consultant_id, title, location, scheduled_at")
      .eq("status", "scheduled")
      .gte("scheduled_at", dayStart)
      .lte("scheduled_at", dayEnd);

    if (error) throw new Error(`could not read sessions: ${error.message}`);

    if (!sessions || sessions.length === 0) {
      console.log("[coaching-reminders] nothing scheduled");
      return Response.json({ kind, date: target, sessions: 0, sent: 0 });
    }

    // One query for every reminder of this kind already sent, rather than one
    // per session.
    const { data: alreadySent } = await supabase
      .from("coaching_reminders_sent")
      .select("session_id")
      .eq("kind", kind)
      .in(
        "session_id",
        sessions.map((s) => s.id),
      );

    const done = new Set((alreadySent ?? []).map((r) => r.session_id));

    const devicesByUser = await loadDevices(
      supabase,
      sessions.map((s) => s.consultant_id),
    );

    let sent = 0;
    let failed = 0;
    let removed = 0;
    let skipped = 0;

    for (const session of sessions) {
      if (done.has(session.id) || dryRun) {
        skipped += 1;
        continue;
      }

      const devices = devicesByUser.get(session.consultant_id) ?? [];
      if (devices.length === 0) {
        skipped += 1;
        continue;
      }

      const at = new Date(session.scheduled_at as string);
      const time = sgTimeLabel(at);
      const where = session.location ? ` · ${session.location}` : "";

      const result = await deliver(supabase, devices, {
        title:
          kind === "morning_of"
            ? `Coaching today at ${time}`
            : `Coaching tomorrow at ${time}`,
        body: `${session.title}${where}`,
        tag: `coaching-${session.id}`,
        action: "View",
        requireInteraction: kind === "morning_of",
        silent: false,
        url: base ? `${base}/dashboard` : "/dashboard",
      });

      sent += result.sent;
      failed += result.failed;
      removed += result.removed;

      await supabase.from("coaching_reminders_sent").upsert(
        {
          session_id: session.id,
          kind,
          status: result.delivered ? "sent" : "failed",
          error_message: result.delivered
            ? null
            : (result.error ?? "no device accepted the notification"),
          sent_at: new Date().toISOString(),
        },
        { onConflict: "session_id,kind" },
      );
    }

    const summary = {
      kind,
      date: target,
      dryRun,
      sessions: sessions.length,
      sent,
      failed,
      removed,
      skipped,
    };

    console.log("[coaching-reminders] done %o", summary);
    return Response.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[coaching-reminders] fatal: %s", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

/*
 * There is deliberately no `export const config = { schedule }` here.
 *
 * Declaring a schedule turns this into a Netlify Scheduled Function, and a
 * scheduled function has NO PUBLIC HTTP ENDPOINT in production - Netlify
 * answers /.netlify/functions/coaching-reminders with an empty 403 at the edge, before
 * the function is reached. That block was therefore not the harmless
 * documentation it looked like: it was the thing preventing any caller from
 * ever running this.
 *
 * The schedule lives in .github/workflows/reminders.yml, which calls this
 * over HTTP with the shared token:
 *
 *   0 0,11 * * * UTC = 08:00 and 19:00 Asia/Singapore
 */
