import {
  adminClient,
  alreadySent,
  authoriseRun,
  consultantEmail,
  emailConfigured,
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
  const url = new URL(request.url);

  // Every caller presents the token. `isManual` used to sit in front of this
  // and was `method === "POST" || method === "GET"` - true for every request
  // that can reach a function, so it gated nothing.
  if (!authoriseRun(request)) {
    return new Response("Unauthorised", { status: 401 });
  }

  const businessDate = url.searchParams.get("date") ?? sgToday();
  const dryRun = url.searchParams.get("dryRun") === "true";

  console.log(
    "[reminder-consultants] start date=%s dryRun=%s",
    businessDate,
    dryRun,
  );

  if (!emailConfigured()) {
    console.log(
      "[reminder-consultants] skipped: no Resend sender configured. Push notifications are handling reminders.",
    );
    return Response.json({
      businessDate,
      skipped: "email not configured",
      sent: 0,
      failed: 0,
    });
  }

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

/*
 * There is deliberately no `export const config = { schedule }` here.
 *
 * Declaring a schedule turns this into a Netlify Scheduled Function, and a
 * scheduled function has NO PUBLIC HTTP ENDPOINT in production - Netlify
 * answers /.netlify/functions/reminder-consultants with an empty 403 at the edge, before
 * the function is reached. That block was therefore not the harmless
 * documentation it looked like: it was the thing preventing any caller from
 * ever running this.
 *
 * The schedule lives in .github/workflows/reminders.yml, which calls this
 * over HTTP with the shared token:
 *
 *   0 13 * * * UTC = 21:00 Asia/Singapore
 */
