import type { Config } from "@netlify/functions";
import {
  adminClient,
  adminDigestEmail,
  alreadySent,
  authoriseManualRun,
  findAdmins,
  findMissing,
  logReminder,
  sendEmail,
  sgToday,
  summarise,
  type SendOutcome,
} from "./lib/reminders.mts";

const REMINDER_TYPE = "admin_digest";

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
  const scheduled = url.searchParams.get("scheduled") !== null;

  if (!scheduled && !authoriseManualRun(request)) {
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
      ...summary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[reminder-admin-digest] fatal: %s", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const config: Config = {
  // 22:00 UTC = 06:00 Asia/Singapore, after the overnight chase has ended.
  schedule: "0 22 * * *",
};
