import type { Config } from "@netlify/functions";
import {
  adminClient,
  alreadySent,
  authoriseManualRun,
  consultantEmail,
  findMissing,
  logReminder,
  sendEmail,
  sgToday,
  summarise,
  type SendOutcome,
} from "./lib/reminders.mts";

const REMINDER_TYPE = "consultant_missing";

/**
 * Nudge anyone who has not submitted today.
 *
 * Runs at 13:00 UTC, which is 21:00 in Singapore - about three hours before
 * the 23:59 deadline, so the email is something a consultant can still act on.
 * The original brief scheduled this at 23:59 itself, which would have given
 * sixty seconds' notice.
 *
 * Exactly one email per person per day. reminder_logs carries a unique key on
 * (user_id, business_date, reminder_type), so a Netlify retry cannot send a
 * second one.
 */
export default async function handler(request: Request) {
  const isManual = request.method === "POST" || request.method === "GET";
  const url = new URL(request.url);
  const scheduled = url.searchParams.get("scheduled") !== null;

  // A manual invocation must present the shared token. The scheduled run
  // arrives from Netlify itself and carries no request to authorise.
  if (isManual && !scheduled && !authoriseManualRun(request)) {
    return new Response("Unauthorised", { status: 401 });
  }

  const businessDate = url.searchParams.get("date") ?? sgToday();
  const dryRun = url.searchParams.get("dryRun") === "true";

  console.log(
    "[reminder-consultants] start date=%s dryRun=%s",
    businessDate,
    dryRun,
  );

  try {
    const supabase = adminClient();
    const missing = await findMissing(supabase, businessDate);

    console.log("[reminder-consultants] %d missing", missing.length);

    const outcomes: SendOutcome[] = [];

    for (const person of missing) {
      if (await alreadySent(supabase, person.user_id, businessDate, REMINDER_TYPE)) {
        outcomes.push({
          userId: person.user_id,
          email: person.email,
          status: "skipped",
        });
        continue;
      }

      if (dryRun) {
        outcomes.push({
          userId: person.user_id,
          email: person.email,
          status: "skipped",
        });
        continue;
      }

      const message = consultantEmail(person.full_name, businessDate);
      const result = await sendEmail({ to: person.email, ...message });

      await logReminder(supabase, {
        userId: person.user_id,
        businessDate,
        reminderType: REMINDER_TYPE,
        status: result.ok ? "sent" : "failed",
        errorMessage: result.ok ? undefined : (result.error ?? "unknown error"),
      });

      if (!result.ok) {
        console.error(
          "[reminder-consultants] failed for %s: %s",
          person.email,
          result.error,
        );
      }

      outcomes.push({
        userId: person.user_id,
        email: person.email,
        status: result.ok ? "sent" : "failed",
        error: result.error,
      });
    }

    const summary = summarise(outcomes);
    console.log("[reminder-consultants] done %o", summary);

    return Response.json({ businessDate, dryRun, ...summary, outcomes });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[reminder-consultants] fatal: %s", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const config: Config = {
  // 13:00 UTC = 21:00 Asia/Singapore. Netlify cron expressions are always UTC.
  schedule: "0 13 * * *",
};
