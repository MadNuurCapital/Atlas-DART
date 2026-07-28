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

/**
 * One combined digest to each admin listing who is still missing.
 *
 * Runs at 15:59 UTC, which is 23:59 in Singapore - the deadline itself. That
 * is deliberate: this list needs to be final, so it must be taken after
 * everyone has had their full day, unlike the 21:00 consultant nudge.
 *
 * A digest is sent even when nobody is missing, because "everyone submitted"
 * is itself information an admin wants at the end of the day.
 */
export default async function handler(request: Request) {
  const url = new URL(request.url);
  const scheduled = url.searchParams.get("scheduled") !== null;

  if (!scheduled && !authoriseManualRun(request)) {
    return new Response("Unauthorised", { status: 401 });
  }

  const businessDate = url.searchParams.get("date") ?? sgToday();
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
  // 15:59 UTC = 23:59 Asia/Singapore, the submission deadline itself.
  schedule: "59 15 * * *",
};
