# Architecture

Next.js App Router on Netlify, Supabase Postgres behind it. Roughly 3,000 lines of application code, most of the interesting decisions in the database.

## The shape of it

```
Browser ── middleware (session refresh, route guard)
        └─ Server Components ── Supabase (as the signed-in user, RLS applies)
        └─ Server Actions ──── Supabase (as the signed-in user, RLS applies)
        └─ /api/export ─────── Supabase (as the signed-in admin, RLS applies)

Netlify Scheduled Functions ── Supabase (service role, RLS bypassed)
```

Only the scheduled functions use the service-role key, because they have no user session. Everything else acts as the signed-in person, so Row Level Security is doing the work rather than application code remembering to filter.

## Where the logic lives

**In Postgres**, because it must hold regardless of which screen or script is talking to it:

- Ownership and visibility — RLS policies
- The 7-day consultant edit window
- Submission timing: `first_submitted_at` write-once, `revision_count` incremented only on a material change
- Appointment ownership derived from the parent submission
- Role and activation immutability for non-admins
- Cancellation requires a reason; restoration is admin-only; cases can never be deleted
- Insurer de-duplication on `lower(btrim(name))`
- All aggregation: GR, appointment counts, compliance, targets

**In TypeScript**, because it is presentation or convenience:

- Singapore date helpers (`lib/sg-date.ts`) mirroring `sg_today()` and `sg_deadline()`
- Zod schemas (`lib/validation.ts`) giving a good error message before the database gives a blunt one
- Target arithmetic (`lib/targets.ts`) for rendering
- Excel generation (`lib/export/`)

Every rule in the TypeScript layer has a matching constraint in the database. A bug in validation degrades the error message, not the data.

## Why views rather than stored totals

`daily_submissions` has no GR column. GR is summed from active cases every time it is asked for.

A stored total needs updating whenever a case is added, edited, cancelled or restored — four places to get right, and one missed path leaves a figure that is wrong and looks authoritative. A view is a little slower and always correct, and at 15–40 people the cost is invisible.

The same reasoning covers AO/AC/FU/N, compliance, and shortfall. The one thing deliberately *not* derived is the appointment rows themselves — those are the source data.

Because the dashboard and the Excel export read the same views, they cannot disagree.

## Date-parameterised reports are functions

A view cannot take an argument, so `missing_submissions(date)`, `team_daily(date)` and `monthly_compliance(year, month)` are functions. They default to `sg_today()`. They are `SECURITY INVOKER` (the default), so RLS still applies.

Views carry `security_invoker = true` explicitly. Without it a view runs as its owner and becomes a complete RLS bypass — the single most dangerous default in this stack.

## Time

Every compliance decision happens in `Asia/Singapore`, never in the browser.

- `timestamptz` stored as UTC; business dates as `date`
- `public.sg_today()` is the single definition of "today"
- `lib/sg-date.ts` reads the UTC offset from the IANA database via `Intl` for the specific instant rather than assuming +08:00

Singapore has had no daylight saving since 1935, so hardcoding +8 would work — but reading the real offset costs nothing and means the code is not quietly wrong if that ever changes.

One subtlety, found by a test: `Intl.DateTimeFormat.formatToParts` has no millisecond field, so the offset must be computed against an instant truncated to the whole second. Otherwise a 23:59:59.999 deadline lands 999ms out, and a submission made in the final second of the day is marked late.

## Client and server components

Server by default. A component becomes `"use client"` only when it needs state, an event handler or a subscription — the daily form, the appointment manager, the case list, the team board.

Mutations are Server Actions taking `FormData` and returning a result object, driven from the client by `useTransition`. Not `useActionState` with a `useEffect` for toasts: setting state inside an effect to show a toast or close a dialog is a React violation the compiler now flags, and the transition approach reads better anyway.

Form fields are controlled state rather than read from the DOM. The submit confirmation renders in a portal outside the form, so reading values back out of a ref would be both a React violation and a way to submit stale numbers.

## Idempotency

Submissions upsert onto `unique (user_id, business_date)` rather than checking first. A double-click or a retried request lands on the same row, and the timing trigger compares the incoming figures with the stored ones — identical values change nothing at all, so no false revision is recorded.

Reminders upsert onto `unique (user_id, business_date, reminder_type)`, so a Netlify retry cannot send a second email.

## What is deliberately absent

- **No ORM.** The Supabase client plus hand-written SQL for the reporting layer. An ORM would obscure the RLS behaviour that matters most here.
- **No state management library.** Server Components fetch; `router.refresh()` after a mutation.
- **No date library.** `Intl` is IANA-aware and already present.
- **No stored aggregates.** See above.
- **No soft-delete flags beyond `cases.status`.** Records are either real or cancelled; there is no third state to reason about.

## Extending it

Adding a policy type is a one-line change to the CHECK constraint in `0007_cases.sql` plus `POLICY_TYPES` in `lib/constants.ts`. The export cross-tab picks it up automatically.

Adding a report means adding a view or function in a new migration and reading it — do not compute it in TypeScript, or the export and the dashboard will drift.

Changing the edit window is `edit_window_days()` in `0001_helpers.sql` and `EDIT_WINDOW_DAYS` in `lib/sg-date.ts`. Both, or the UI and the database will disagree about what is allowed.
