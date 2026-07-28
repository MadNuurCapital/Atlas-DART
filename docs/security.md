# Security model

## The boundary is Postgres, not the middleware

There are three layers between a request and someone else's data. Only the last one is load-bearing.

1. **Middleware** (`middleware.ts`) refreshes the session, redirects anonymous visitors to `/login`, and keeps non-admins out of `/admin/*`. This is convenience and user experience.
2. **Server-side role checks** (`src/lib/auth.ts`) re-verify the role in every admin server action, layout and API route. This is defence in depth, because middleware can be misconfigured by a bad matcher.
3. **Row Level Security** (`supabase/migrations/0011_rls.sql`) filters every row Postgres returns, for every query, from every client.

If layers 1 and 2 were deleted tomorrow, a consultant still could not read another consultant's submissions, appointments, cases or targets. That property is what `tests/db/rls.test.ts` asserts, against a real PostgreSQL 16 instance rather than a mock.

## Three details that would silently break everything

**`force row level security`, not `enable`.** Plain `enable` exempts the table owner. Since the application connects through a role that may own these tables, plain `enable` would leave every policy inert. Every table uses `force`, and there is a test asserting that all eight still do.

**`security_invoker = true` on every view.** By default a view executes with its *creator's* privileges. A view over `daily_submissions` without this flag is a complete RLS bypass — any consultant could select the entire team through it. Every view in `0010_views.sql` sets it.

**`is_admin()` is `SECURITY DEFINER` with a pinned `search_path`.** It is called by the RLS policies on `profiles`, and it reads `profiles`. Without `SECURITY DEFINER` that recurses. The pinned `search_path` stops a caller redirecting the function to a table of their own making.

## What each role can do

| Table | Consultant | Admin |
|---|---|---|
| `profiles` | read own, update own except `role`/`active` | read all, update all |
| `consultant_targets` | read own | read all, write all |
| `daily_submissions` | read/write own, within 7 days | read all, write all, any date |
| `appointment_activities` | read/write/delete own, within 7 days | read all, write all |
| `insurers` | read all, **insert** | read all, insert, rename, retire |
| `cases` | read own, insert own, update own (cannot un-cancel) | read all, write all, restore |
| `reminder_logs` | read own | read all |
| `audit_logs` | insert only | read all, insert |

`anon` has no access to anything.

## Rules enforced by Postgres, not by screens

These are business rules that would be trivial to bypass if they lived only in the UI:

- **A case can never be deleted.** There is no `DELETE` policy on `cases` for any role, and `DELETE` is never granted. Cancellation is a status change that keeps the row.
- **A cancellation must carry a reason.** `cases_cancellation_complete` is a CHECK constraint: cancelled requires both `cancelled_at` and a non-blank reason, and an active case must carry neither.
- **Only an admin may restore a cancelled case.** Enforced by the `guard_case_restore` trigger, because an RLS policy only sees the row being written and cannot ask what the status used to be.
- **A consultant cannot change their own role or activation.** Enforced by the `guard_profile_columns` trigger, because RLS grants whole rows and cannot express "not this column".
- **Submission timing cannot be forged.** `first_submitted_at`, `last_submitted_at` and `revision_count` are overwritten by the `handle_submission_timing` trigger on every write. A client that could backdate `first_submitted_at` could claim to have beaten a deadline it missed.
- **An appointment cannot be attached to someone else's day.** `enforce_appointment_parent` rewrites `user_id` and `business_date` from the parent submission, and the RLS `WITH CHECK` then rejects the row if that owner is not the caller.

## Keys

| Key | Where it may appear |
|---|---|
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Anywhere. It is filtered by RLS. |
| `SUPABASE_SECRET_KEY` | `src/lib/supabase/admin.ts` only. |

The secret key bypasses RLS entirely. `src/lib/supabase/admin.ts` imports `server-only`, which turns any client-side import into a build error rather than a runtime surprise. `tests/unit/no-secret-leak.test.ts` additionally asserts that no `"use client"` module references it and that it never appears in a built client bundle.

Supabase's current key naming is publishable/secret (`sb_publishable_…`, `sb_secret_…`), which replaced the legacy anon/service_role names.

## Deliberate choices worth knowing

**Login errors are vague on purpose.** "Those details did not match" rather than "no such account", so the form cannot be used to enumerate which email addresses are real. An E2E test asserts the message never leaks that distinction.

**Redirects after login are path-only.** `redirectTo` is rejected unless it starts with a single `/`, which closes the open-redirect hole.

**`getUser()` rather than `getSession()`.** `getSession()` trusts a cookie the browser could have tampered with; `getUser()` revalidates against the Auth server.

**Admins can set their own targets.** This was a deliberate decision (D8). It is acceptable only because `audit_logs` is append-only — there is no `UPDATE` or `DELETE` policy for anyone, including admins — so the change is permanently attributable.

## Known accepted risks

- **Consultants can add insurers** (D19). Mitigated by a unique index on `lower(btrim(name))`, name normalisation on write, and an admin merge/rename path — but a determined typo will still create a near-duplicate that an admin must merge.
- **A case counts for GR at submission, before inception** (D16). Business that never goes live sits in the totals until someone cancels it. The *Pending Inception* view exists so this is visible rather than silent.
- **RLS has been verified against PostgreSQL 16 with a Supabase auth shim**, not yet against the real Supabase project. Re-run `npm run test:db` against the live database once it exists.
