import {
  adminClient,
  alreadySent,
  appUrl,
  authoriseRun,
  findMissing,
  sgHour,
  sgToday,
  withinHourWindow,
} from "./lib/reminders.mts";
import { configureVapid, deliver, loadDevices } from "./lib/push.mts";

/**
 * The evening chase.
 *
 * Five runs a night, not twelve:
 *
 *   7:00 PM SGT    firm      "closes at 11:59 PM, takes two minutes"
 *   9:00 PM SGT    urgent    "submit before you forget"
 *   11:00 PM SGT   final     "last call"
 *   11:59 PM SGT   deadline  "closing now"          <- ?slot=deadline
 *   6:00 AM SGT    overdue   SILENT, and about YESTERDAY
 *
 * It used to run every hour from 7 PM to 6 AM, which meant someone who forgot
 * got twelve notifications in a night - seven of them between midnight and
 * dawn. Twelve notifications is not twelve times the reminder; past about the
 * third it is noise, and noise is what people turn off. Four audible
 * notifications spaced two hours apart say the same thing and leave the
 * permission intact.
 *
 * The 6 AM run is silent and talks about yesterday: the day is already late
 * whatever anyone does, so it waits on the lock screen rather than waking the
 * team, and it lands just before the admin digest goes out - the last chance
 * to fix it before someone else sees the list.
 *
 * Submitting removes someone from the list, and the chase stops. That is the
 * only way to stop it, which is the point.
 */

const NAG_END_HOUR = 7;

/**
 * The chase window, in Singapore hours, both ends inclusive: 7 PM to 6 AM.
 *
 * These are exactly the hours the schedule aims at (11:00-22:00 UTC). A run
 * landing outside them is a late one, and a late chase is not a chase - it is
 * a notification at a time nobody agreed to.
 */
const WINDOW_FROM = 19;
const WINDOW_TO = 6;

/**
 * The 11:59 PM final call, which needs a name of its own.
 *
 * Everything else in this function is identified by its Singapore hour, and
 * 11:59 PM is hour 23 - the same hour as the 11 PM chase. See the handler.
 */
export const DEADLINE_SLOT = "deadline";
export const DEADLINE_HOUR = 23;

export type Level = "firm" | "urgent" | "final" | "deadline" | "overdue";

function levelForHour(hour: number): Level {
  if (hour < NAG_END_HOUR) return "overdue";
  if (hour < 21) return "firm";
  if (hour < 23) return "urgent";
  return "final";
}

/** What this run is, given the hour it woke in and the slot it was called as. */
export function levelFor(hour: number, slot: string | null): Level {
  return slot === DEADLINE_SLOT ? "deadline" : levelForHour(hour);
}

/**
 * The reminder_logs key, which is also the idempotency key.
 *
 * Two runs that produce the same key are the same reminder as far as the log
 * is concerned, and the second one sends nothing. That is the whole point when
 * it is a retry - and a bug when it is the 11:59 PM final call sharing hour 23
 * with the 11 PM one, which is why the slot takes precedence over the hour.
 */
export function reminderTypeFor(hour: number, slot: string | null): string {
  return slot ? `push_${slot}` : `push_${hour}`;
}

export function copyFor(level: Level, firstName: string) {
  switch (level) {
    case "overdue":
      return {
        title: `Yesterday's DART is still missing, ${firstName}`,
        body: "It is already late. Submit it before your admin gets the 6 AM list.",
        requireInteraction: true,
        silent: true,
      };
    case "deadline":
      return {
        title: `Closing now, ${firstName}`,
        body: "This is the last minute to submit today's DART.",
        requireInteraction: true,
        silent: false,
      };
    case "final":
      return {
        title: `Last call, ${firstName} — DART closes at 11:59 PM`,
        body: "Submit now or today counts as missed.",
        requireInteraction: true,
        silent: false,
      };
    case "urgent":
      return {
        // Deliberately not the same title as "firm". These notifications share
        // a tag, so each one REPLACES the last in the tray rather than
        // stacking: with identical titles the 9 PM reminder is indistinguishable
        // from the 7 PM one still sitting there unread, and a notification that
        // looks like one you have already seen is one you do not read.
        title: `Still not updated, ${firstName}`,
        body: "Closes at 11:59 PM tonight. Submit before you forget.",
        requireInteraction: true,
        silent: false,
      };
    default:
      return {
        title: `Your DART is not updated, ${firstName}`,
        body: "Closes at 11:59 PM. It takes about two minutes.",
        requireInteraction: false,
        silent: false,
      };
  }
}

/** Yesterday, in the Singapore calendar. */
function previousDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d - 1, 12));
  return shifted.toISOString().slice(0, 10);
}

export default async function handler(request: Request) {
  const url = new URL(request.url);

  if (!authoriseRun(request)) {
    return new Response("Unauthorised", { status: 401 });
  }

  const hour = Number(url.searchParams.get("hour") ?? sgHour());

  // The 11:59 PM run shares its hour with the 11 PM one, so the hour alone
  // cannot tell them apart - and the log key is built from it. Without a
  // separate name both runs key on `push_23`, the second finds the first in
  // reminder_logs, and the final call is skipped as a duplicate of the thing
  // it is supposed to follow. The schedule passes ?slot=deadline for it.
  const slot = url.searchParams.get("slot");
  if (slot !== null && slot !== DEADLINE_SLOT) {
    return Response.json(
      { error: `unknown slot "${slot}"`, known: [DEADLINE_SLOT] },
      { status: 400 },
    );
  }

  const level = levelFor(hour, slot);

  // Overnight the day being chased is yesterday. Today has barely started.
  const businessDate =
    url.searchParams.get("date") ??
    (hour < NAG_END_HOUR ? previousDay(sgToday()) : sgToday());

  const dryRun = url.searchParams.get("dryRun") === "true";
  const reminderType = reminderTypeFor(hour, slot);

  console.log(
    "[push-reminders] start date=%s hour=%d slot=%s level=%s dryRun=%s",
    businessDate,
    hour,
    slot ?? "-",
    level,
    dryRun,
  );

  // The final call is the one slot that cannot run late.
  //
  // It says "closing now", and at 00:20 nothing is closing - the day shut
  // twenty minutes ago. pg_cron delivers this one on the minute; GitHub's
  // copy of the same schedule routinely arrives 15-40 minutes behind, which
  // here means after midnight. So a late one sends nothing and the 6 AM
  // overdue run picks the person up instead.
  if (slot === DEADLINE_SLOT && hour !== DEADLINE_HOUR) {
    console.log(
      "[push-reminders] deadline slot arrived at hour=%d - too late, sending nothing",
      hour,
    );
    return Response.json({
      businessDate,
      hour,
      slot,
      skipped: "the final call arrived after the deadline",
      missing: 0,
      sent: 0,
    });
  }

  // Refuse to chase outside the hours the team agreed to.
  //
  // The schedule aims at 7 PM - 6 AM, but a run can arrive hours late, and
  // this function reads the clock to decide what to send. Without this check a
  // slipped run nagged everyone at lunchtime. Nothing is sent and nothing is
  // logged, so the hour is still free to run properly if it ever arrives.
  //
  // Pass ?hour= to test a specific hour; the check applies to that hour, so a
  // simulated 19 behaves exactly as 7 PM would.
  if (!withinHourWindow(hour, WINDOW_FROM, WINDOW_TO)) {
    console.log(
      "[push-reminders] hour=%d is outside the %d:00-%d:00 window - sending nothing",
      hour,
      WINDOW_FROM,
      WINDOW_TO,
    );
    return Response.json({
      businessDate,
      hour,
      skipped: "outside the chase window",
      window: `${WINDOW_FROM}:00-0${WINDOW_TO}:00 Asia/Singapore`,
      missing: 0,
      sent: 0,
    });
  }

  try {
    configureVapid();
    const base = appUrl();

    const supabase = adminClient();
    const missing = await findMissing(supabase, businessDate);

    if (missing.length === 0) {
      console.log("[push-reminders] nobody missing - nothing to do");
      return Response.json({ businessDate, hour, level, missing: 0, sent: 0 });
    }

    const byUser = await loadDevices(
      supabase,
      missing.map((m) => m.user_id),
    );

    let sent = 0;
    let failed = 0;
    let removed = 0;
    let skipped = 0;

    for (const person of missing) {
      const devices = byUser.get(person.user_id) ?? [];
      if (devices.length === 0) {
        skipped += 1;
        continue;
      }

      // Already chased this person in this hour? A Netlify retry must not
      // buzz the same phone twice. A previous *failure* is retried though -
      // if the first attempt never reached the phone, the retry is the whole
      // point of there being one.
      const already = await alreadySent(
        supabase,
        person.user_id,
        businessDate,
        reminderType,
      );

      if (already || dryRun) {
        skipped += 1;
        continue;
      }

      const firstName = person.full_name.split(" ")[0] ?? person.full_name;
      const message = copyFor(level, firstName);

      const result = await deliver(supabase, devices, {
        ...message,
        tag: "dart-daily-reminder",
        url: base
          ? `${base}/today?date=${businessDate}`
          : `/today?date=${businessDate}`,
      });

      sent += result.sent;
      failed += result.failed;
      removed += result.removed;

      await supabase.from("reminder_logs").upsert(
        {
          user_id: person.user_id,
          business_date: businessDate,
          reminder_type: reminderType,
          status: result.delivered ? "sent" : "failed",
          error_message: result.delivered
            ? null
            : (result.error ?? "no device accepted the notification"),
          sent_at: new Date().toISOString(),
        },
        { onConflict: "user_id,business_date,reminder_type" },
      );
    }

    const summary = {
      businessDate,
      hour,
      slot,
      level,
      silent: level === "overdue",
      dryRun,
      missing: missing.length,
      sent,
      failed,
      removed,
      skipped,
      withoutDevices: missing.filter((m) => !byUser.has(m.user_id)).length,
    };

    console.log("[push-reminders] done %o", summary);
    return Response.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[push-reminders] fatal: %s", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

/*
 * There is deliberately no `export const config = { schedule }` here.
 *
 * Declaring a schedule turns this into a Netlify Scheduled Function, and a
 * scheduled function has NO PUBLIC HTTP ENDPOINT in production - Netlify
 * answers /.netlify/functions/push-reminders with an empty 403 at the edge, before
 * the function is reached. That block was therefore not the harmless
 * documentation it looked like: it was the thing preventing any caller from
 * ever running this.
 *
 * The schedule lives in .github/workflows/reminders.yml, which calls this
 * over HTTP with the shared token, and is mirrored in pg_cron:
 *
 *   0 11  * * *  UTC = 19:00 SGT
 *   0 13  * * *  UTC = 21:00 SGT
 *   0 15  * * *  UTC = 23:00 SGT
 *   59 15 * * *  UTC = 23:59 SGT  (&slot=deadline)
 *   0 22  * * *  UTC = 06:00 SGT  (silent, yesterday)
 */
