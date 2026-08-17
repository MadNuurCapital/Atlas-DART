# Reminder functions

Three Netlify Scheduled Functions.

| Function | Cron (UTC) | Singapore | What it does |
|---|---|---|---|
| `push-reminders` | `0 11-22 * * *` | hourly 19:00–06:00 | Chases anyone still missing |
| `reminder-consultants` | `0 13 * * *` | 21:00 | One email — **skips itself entirely** until a Resend sender exists |
| `reminder-admin-digest` | `0 22 * * *` | 06:00 | Notifies admins of yesterday's missing list, and emails it too if Resend is set up |

**Nothing here needs a domain.** Push notifications need only the VAPID keys,
so both the hourly chase and the 6am admin list work as-is. Email is the
optional extra on top.

`reminder-consultants` returns early when `RESEND_API_KEY` or
`REMINDER_FROM_EMAIL` is unset, rather than attempting a send it knows will
fail. Otherwise it would write one fabricated `failed` row per person per day,
which buries real failures and marks the day as already attempted.

## Who actually fires these

Each function declares its own cron in `export const config`, and Netlify is
meant to invoke it. On the live site it never did — `reminder_logs` was empty
from launch until the problem was found, not one attempt, while the functions
themselves answered correctly over HTTP and a test push reached a phone. The
declaration was right; the scheduler never ran it.

So `.github/workflows/reminders.yml` calls the same four functions on the same
crons from GitHub Actions. **The `export const config` blocks stay** — they
cost nothing, they document the intended schedule next to the code it belongs
to, and if Netlify's scheduler ever starts working the duplicate run sends
nothing twice: every send is written to `reminder_logs` under a unique
`(user_id, business_date, reminder_type)` key and an already-sent reminder is
skipped.

The workflow needs **one** repository secret: `REMINDER_TEST_TOKEN`, matching
the env var of the same name in Netlify. `APP_URL` is an optional second one
that only overrides the production address baked into the workflow — a site
address is not a secret, and making someone paste two things to fix one problem
is how a fix goes unapplied.

It authenticates with an `Authorization: Bearer` header rather than a `?token=`
query string, because query strings are written to logs. It can also be fired
by hand from the Actions tab, with a dry-run option.

Two properties of GitHub's scheduler are worth knowing: a run can start several
minutes late when GitHub is busy, and scheduled workflows are disabled
automatically in a repository with no commits for 60 days. If reminders go
quiet after a long stretch of nobody touching the repo, check
**Actions → Reminders** for a disabled workflow before looking anywhere else.

## The hourly chase

`push-reminders` runs every hour from 11:00 to 22:00 UTC — 19:00 through 06:00
in Singapore. That is a contiguous UTC range even though it crosses Singapore
midnight, so it is one cron rather than two.

| Singapore | Level | Sound | About |
|---|---|---|---|
| 7–8pm | firm | yes | today |
| 9–10pm | urgent | yes | today |
| 11pm | final | yes | today |
| midnight–6am | overdue | **silent** | **yesterday** |

Two things worth understanding:

**Overnight it chases yesterday.** At 2am nobody owes anything for the day that
just started. `nagBusinessDate()` and the function agree on this, so the
notification, the banner and the Submit link all point at the same day.

**Overnight it is silent.** The day is already late whatever anyone does, so the
notification waits on the lock screen rather than waking the team at 3am. That
is what makes an all-night chase acceptable rather than the thing that makes
everyone disable notifications — which would cost the 7–11pm pings that actually
prevent a missed day.

Notifications share a tag, so a later one replaces the earlier rather than
stacking twelve by morning.

Each hour writes its own `reminder_logs` row (`push_19`, `push_20`, …) so a
Netlify retry is idempotent within the hour without one hour blocking the next.

A subscription that returns 404 or 410 is deleted rather than retried hourly
forever — that status means the browser has thrown it away for good.


## Why the admin digest is at 6am

Not at the 23:59 deadline, which is where the original brief put it. A digest
sent at the deadline names people who then submit at 1am — and an admin who has
been told someone missed will remember that whatever the record says afterwards.

At 6am the overnight chase has finished and the list can no longer change.

The digest reaches an admin two ways, logged separately because they succeed
and fail independently:

| Channel | `reminder_type` | Needs |
|---|---|---|
| Notification | `admin_digest_push` | VAPID keys, and the admin has enabled notifications |
| Email | `admin_digest` | A verified Resend sender |

The notification names up to five people rather than only counting them —
"three people" just sends an admin into the app to find out who, which is the
work the digest exists to save. It opens `/admin/daily` for that date.

When nobody is missing the notification is silent: "everyone submitted" is
worth knowing, but not worth a sound at 6am.

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

Prefer `Authorization: Bearer <token>` over `?token=` for anything that runs
more than once — a query string is written to Netlify's request logs, and the
GitHub workflow uses the header for exactly that reason. The query form is kept
for a quick curl by hand.

**Every caller needs the token, including the schedule.** There is no
unauthenticated path. There used to be: the guard read `if (!scheduled &&
!authoriseManualRun(request))`, where `scheduled` meant only that the URL
carried a `?scheduled` parameter. That is a fact about the string the caller
typed, not about who the caller is, so anyone who appended `?scheduled` got an
unauthenticated run of the sender against the live team. It was written to let
Netlify's own cron through — which does not send that parameter, so the branch
never once did its job and only held the door open.

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
