import {
  adminClient,
  adminDigestEmail,
  alreadySent,
  appUrl,
  authoriseRun,
  emailConfigured,
  findAdmins,
  findMissing,
  logReminder,
  sendEmail,
  sgToday,
  summarise,
  type MissingPerson,
  type SendOutcome,
} from "./lib/reminders.mts";
import { configureVapid, deliver, loadDevices } from "./lib/push.mts";

const REMINDER_TYPE = "admin_digest";
const PUSH_REMINDER_TYPE = "admin_digest_push";

/**
 * What the 6 AM notification says.
 *
 * Short, because it is read on a lock screen. Names rather than a count alone,
 * because "three people" sends an admin into the app to find out who, and the
 * whole point of the digest is that they should not have to.
 */
function digestPush(missing: MissingPerson[], businessDate: string) {
  if (missing.length === 0) {
    return {
      title: "Everyone submitted yesterday",
      body: "Nothing to chase this morning.",
      silent: true,
      requireInteraction: false,
    };
  }

  const names = missing.map((m) => m.full_name.split(" ")[0] ?? m.full_name);
  const shown = names.slice(0, 5).join(", ");
  const rest = names.length > 5 ? ` and ${names.length - 5} more` : "";

  return {
    title:
      missing.length === 1
        ? `1 person missed the DART for ${businessDate}`
        : `${missing.length} people missed the DART for ${businessDate}`,
    body: `${shown}${rest}.`,
    silent: false,
    requireInteraction: true,
  };
}

/** Yesterday, in the Singapore calendar. */
function previousDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - 1, 12)).toISOString().slice(0, 10);
}

/**
 * One combined digest to each admin listing who missed yesterday.
 *
 * Runs at 22:00 UTC, which is 06:00 in Singapore - after the overnight chase
 * has finished and the list can no longer change. It reports on YESTERDAY,
 * because at 6am that is the day whose deadline has passed.
 *
 * Waiting until morning is deliberate. A digest at the 23:59 deadline would
 * name people who then submitted at 1am, and an admin who has been told
 * someone missed will remember that whatever the record says afterwards.
 *
 * A digest is sent even when nobody is missing, because "everyone submitted"
 * is itself information worth having with the morning coffee.
 */
export default async function handler(request: Request) {
  const url = new URL(request.url);
  if (!authoriseRun(request)) {
    return new Response("Unauthorised", { status: 401 });
  }

  // At 6am the day being reported on is yesterday.
  const businessDate = url.searchParams.get("date") ?? previousDay(sgToday());
  const dryRun = url.searchParams.get("dryRun") === "true";

  console.log(
    "[reminder-admin-digest] start date=%s dryRun=%s",
    businessDate,
    dryRun,
  );

  try {
    const supabase = adminClient();

    const [missing, admins] = await Promise.all([
      findMissing(supabase, businessDate),
      findAdmins(supabase),
    ]);

    console.log(
      "[reminder-admin-digest] %d missing, %d admins",
      missing.length,
      admins.length,
    );

    // --- The notification, which is the channel that actually works today ---
    //
    // Email needs a verified sending domain and there is not one yet. Push
    // needs nothing but the VAPID keys, so this is what an admin will really
    // wake up to. It runs first and independently: a Resend outage must not
    // stop the morning list from arriving.
    const pushSummary = { sent: 0, failed: 0, removed: 0, skipped: 0 };

    if (!dryRun && process.env.VAPID_PRIVATE_KEY) {
      configureVapid();

      const base = appUrl();
      const notification = digestPush(missing, businessDate);
      const devicesByAdmin = await loadDevices(
        supabase,
        admins.map((a) => a.user_id),
      );

      for (const admin of admins) {
        const devices = devicesByAdmin.get(admin.user_id) ?? [];
        if (devices.length === 0) {
          pushSummary.skipped += 1;
          continue;
        }

        if (
          await alreadySent(
            supabase,
            admin.user_id,
            businessDate,
            PUSH_REMINDER_TYPE,
          )
        ) {
          pushSummary.skipped += 1;
          continue;
        }

        const result = await deliver(supabase, devices, {
          ...notification,
          tag: "dart-admin-digest",
          action: missing.length === 0 ? "Open" : "See who",
          url: base
            ? `${base}/admin/daily?date=${businessDate}`
            : `/admin/daily?date=${businessDate}`,
        });

        pushSummary.sent += result.sent;
        pushSummary.failed += result.failed;
        pushSummary.removed += result.removed;

        await logReminder(supabase, {
          userId: admin.user_id,
          businessDate,
          reminderType: PUSH_REMINDER_TYPE,
          status: result.delivered ? "sent" : "failed",
          errorMessage: result.delivered
            ? undefined
            : (result.error ?? "no device accepted the notification"),
        });
      }

      console.log("[reminder-admin-digest] push %o", pushSummary);
    }

    // --- The email, if a sender has been configured ---

    if (!emailConfigured()) {
      console.log(
        "[reminder-admin-digest] no Resend sender configured; the notification above is the digest.",
      );
      return Response.json({
        businessDate,
        dryRun,
        missingCount: missing.length,
        missing: missing.map((m) => m.full_name),
        push: pushSummary,
        email: "not configured",
      });
    }

    const message = adminDigestEmail(missing, businessDate);
    const outcomes: SendOutcome[] = [];

    for (const admin of admins) {
      if (await alreadySent(supabase, admin.user_id, businessDate, REMINDER_TYPE)) {
        outcomes.push({
          userId: admin.user_id,
          email: admin.email,
          status: "skipped",
        });
        continue;
      }

      if (dryRun) {
        outcomes.push({
          userId: admin.user_id,
          email: admin.email,
          status: "skipped",
        });
        continue;
      }

      const result = await sendEmail({ to: admin.email, ...message });

      await logReminder(supabase, {
        userId: admin.user_id,
        businessDate,
        reminderType: REMINDER_TYPE,
        status: result.ok ? "sent" : "failed",
        errorMessage: result.ok ? undefined : (result.error ?? "unknown error"),
      });

      if (!result.ok) {
        console.error(
          "[reminder-admin-digest] failed for %s: %s",
          admin.email,
          result.error,
        );
      }

      outcomes.push({
        userId: admin.user_id,
        email: admin.email,
        status: result.ok ? "sent" : "failed",
        error: result.error,
      });
    }

    const summary = summarise(outcomes);
    console.log("[reminder-admin-digest] done %o", summary);

    return Response.json({
      businessDate,
      dryRun,
      missingCount: missing.length,
      missing: missing.map((m) => m.full_name),
      push: pushSummary,
      ...summary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[reminder-admin-digest] fatal: %s", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

/*
 * There is deliberately no `export const config = { schedule }` here.
 *
 * Declaring a schedule turns this into a Netlify Scheduled Function, and a
 * scheduled function has NO PUBLIC HTTP ENDPOINT in production - Netlify
 * answers /.netlify/functions/reminder-admin-digest with an empty 403 at the edge, before
 * the function is reached. That block was therefore not the harmless
 * documentation it looked like: it was the thing preventing any caller from
 * ever running this.
 *
 * The schedule lives in .github/workflows/reminders.yml, which calls this
 * over HTTP with the shared token:
 *
 *   0 22 * * * UTC = 06:00 Asia/Singapore
 */
