# Reminder functions

Two Netlify Scheduled Functions. Exactly one email per person per day.

| Function | Cron (UTC) | Singapore | Sends to |
|---|---|---|---|
| `reminder-consultants` | `0 13 * * *` | 21:00 | Anyone with no submission today |
| `reminder-admin-digest` | `59 15 * * *` | 23:59 | Every active admin |

## Why two, and why those times

The original brief scheduled a single reminder at 23:59 Singapore — which is also the submission deadline. That gives a consultant sixty seconds to act, so it is a post-mortem rather than a reminder.

The nudge therefore fires at **21:00**, about three hours before the deadline, when it is still something a person can act on. The admin digest fires at **23:59**, because that list needs to be *final* — taken any earlier and it names people who went on to submit.

Cron expressions in `netlify.toml` and in `export const config` are always UTC. Singapore is UTC+8 year-round with no daylight saving, so the conversion is fixed.

## What each run does

1. Work out the current Singapore date **itself** — `Intl.DateTimeFormat` with `timeZone: "Asia/Singapore"` — rather than trusting the runtime's clock or locale.
2. Call `missing_submissions(date)`, which returns every **active** person with no `submitted` record for that date. A draft does not count; a half-filled form is not a submission. Admins are included, because they submit too.
3. For each person, check `reminder_logs` for an existing `sent` row. A previous *failure* is retried; a previous *success* is not.
4. Send through Resend.
5. Upsert the outcome into `reminder_logs` on `(user_id, business_date, reminder_type)`.

The unique key is the real guarantee. Netlify may retry a scheduled function, and a retry lands on the same row rather than sending a second email.

A failed row must carry an error message — `reminder_logs_failure_has_reason` is a CHECK constraint, so a silent failure cannot be recorded. Silent failure is how a reminder system rots without anyone noticing.

The digest is sent even when nobody is missing. "Everyone submitted" is information an admin wants at the end of a day.

## Testing before the cron goes live

**Netlify Dev does not fire crons.** `netlify dev` serves the functions but never invokes them on a schedule — they must be triggered by hand.

Set `REMINDER_TEST_TOKEN` to a long random string first. Without it the manual trigger refuses everything: it fails closed, because an unguarded endpoint that emails the whole team is not something to leave open because an environment variable was forgotten.

```bash
netlify dev

# Dry run - reports who WOULD be emailed, sends nothing, writes no log rows
curl "http://localhost:8888/.netlify/functions/reminder-consultants?dryRun=true&token=$REMINDER_TEST_TOKEN"

# Real send for today
curl "http://localhost:8888/.netlify/functions/reminder-consultants?token=$REMINDER_TEST_TOKEN"

# A specific date, useful for reproducing a past day
curl "http://localhost:8888/.netlify/functions/reminder-consultants?date=2026-03-10&token=$REMINDER_TEST_TOKEN"

# Admin digest
curl "http://localhost:8888/.netlify/functions/reminder-admin-digest?dryRun=true&token=$REMINDER_TEST_TOKEN"
```

The token may also be sent as `Authorization: Bearer <token>`.

Against a deployed site, swap the host for your Netlify URL. You can also invoke a deployed scheduled function from the Netlify UI under **Functions → the function → Trigger**.

Start with `dryRun=true`. Confirm the list of names is who you expect **before** sending anything to real people.

### Verifying afterwards

```sql
select p.full_name, r.reminder_type, r.status, r.error_message, r.sent_at
  from public.reminder_logs r
  join public.profiles p on p.id = r.user_id
 where r.business_date = current_date
 order by r.sent_at desc;
```

To re-send during testing, delete the log rows for that date first — otherwise the idempotency guard correctly skips everyone.

## Email content

**Consultant** — subject `Daily DART Update Missing`:

> Assalamualaikum [First name], your DART update for [date] has not been submitted yet. Please complete it as soon as possible.

Plus a button to `/today` when `APP_URL` is set.

**Admin digest** — subject `DART: N missing for YYYY-MM-DD`, listing each missing person by name, with a link to `/admin/daily`.

Names are HTML-escaped. They come from the database, but a name is still untrusted input.

## Environment

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `SUPABASE_SECRET_KEY` | Service role. These functions have no user session, so they bypass RLS by necessity — the only place in the codebase that does. |
| `RESEND_API_KEY` | Resend API key |
| `REMINDER_FROM_EMAIL` | e.g. `DART Tracker <dart@yourdomain.com>` — the domain must be verified in Resend |
| `APP_URL` | Base URL used for the links in emails |
| `REMINDER_TEST_TOKEN` | Guards the manual trigger |

If `RESEND_API_KEY` or `REMINDER_FROM_EMAIL` is missing, the send fails cleanly and the reason is written to `reminder_logs.error_message` rather than throwing.

## Before launch

- Verify a sending domain in Resend. An unverified domain silently lands in spam.
- Run both functions with `dryRun=true` against production and check the names.
- Send one real test to yourself.
- Confirm `reminder_logs` rows appear with status `sent`.
- Only then let the crons run unattended.

Consider pointing Supabase's own SMTP settings at the same Resend account. Supabase's built-in email sender is rate-limited to a handful per hour and is not intended for production, which matters when inviting the whole team at once.
