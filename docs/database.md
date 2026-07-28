# Database

PostgreSQL via Supabase. Migrations in `supabase/migrations/`, applied in filename order.

| File | Contents |
|---|---|
| `0001_helpers.sql` | `set_updated_at`, `sg_today`, `sg_deadline`, `edit_window_days`, `within_edit_window` |
| `0002_profiles.sql` | `profiles`, `is_admin()`, column guard, auth signup trigger |
| `0003_consultant_targets.sql` | Effective-dated GR targets |
| `0004_daily_submissions.sql` | Daily rows and the submission-timing trigger |
| `0005_appointment_activities.sql` | Prospect appointments and the parent-ownership trigger |
| `0006_insurers.sql` | Consultant-extendable insurer list |
| `0007_cases.sql` | Signed cases and the restore guard |
| `0008_reminder_logs.sql` | Idempotency record for the scheduled reminders |
| `0009_audit_logs.sql` | Append-only trail |
| `0010_views.sql` | Reporting views and report functions |
| `0011_rls.sql` | Row Level Security and grants |
| `0012_seed_insurers.sql` | Singapore insurer seed list |
| `0013_realtime.sql` | Publication for the live admin dashboard |
| `0014_push_subscriptions.sql` | Devices subscribed to notifications, with their failure counts |
| `0015_reminder_types.sql` | Widens `reminder_type` to allow `push_<hour>` |
| `0016_admin_digest_push.sql` | Adds `admin_digest_push`, so the 6am list logs its notification separately from its email |

Every migration is re-runnable. Applying the whole set to a database that
already has some of it is a no-op rather than an error - triggers and policies
are dropped before being recreated, seeds use `ON CONFLICT DO NOTHING`.
`scripts/test-db.sh` applies the bundle twice on every run so that stays true.

## Time

Everything time-related is decided in `Asia/Singapore`, never in the browser.

- Timestamps are `timestamptz`, stored in UTC.
- Business dates are `date`.
- `public.sg_today()` is `(now() at time zone 'Asia/Singapore')::date`. It is the single definition of "today".
- `public.sg_deadline(date)` returns 23:59:59.999 Singapore time as a `timestamptz`.

The TypeScript side mirrors this in `src/lib/sg-date.ts`, which reads the UTC offset from the IANA database via `Intl` for the specific instant rather than assuming +08:00.

> One subtlety, found by a test: `Intl.DateTimeFormat.formatToParts` has no millisecond field, so the offset must be computed against an instant truncated to the whole second. Otherwise a 23:59:59.999 deadline comes out 999ms wrong.

## Triggers that carry business rules

**`handle_submission_timing`** (`daily_submissions`) owns `first_submitted_at`, `last_submitted_at` and `revision_count`. Whatever a client sends for those three columns is discarded.

- Insert as `submitted` → both timestamps set, revision 0.
- Insert as `draft` → no timestamps.
- Draft → submitted → `first_submitted_at` set, still revision 0. Becoming submitted is not a revision.
- Submitted → submitted **with changed figures** → `last_submitted_at` moves, revision increments.
- Submitted → submitted **with identical figures** → nothing changes at all. This is what makes a double-click or a retried request harmless.

The comparison covers `dials`, `talked_to`, `campaign_status`, `in_office` and `notes` — the values management actually reads.

**`enforce_appointment_parent`** (`appointment_activities`) rewrites `user_id` and `business_date` from the parent submission, so ownership cannot be forged across rows.

**`guard_profile_columns`** (`profiles`) rejects a non-admin changing `role`, `active` or `id`.

**`guard_case_restore`** (`cases`) rejects a non-admin moving a case from `cancelled` back to `active`, or reassigning it to another consultant.

**`normalise_insurer_name`** (`insurers`) trims and collapses whitespace so `"  aia   singapore "` collides with `"AIA Singapore"` on the unique index instead of being stored alongside it.

All four skip their check when `auth.uid()` is null, which is a service-role connection — already outside RLS by design.

## Views and report functions

All views are `security_invoker = true`. See `docs/security.md` for why that matters.

| Object | Purpose |
|---|---|
| `v_daily_consultant_summary` | One row per submission with AO/AC/FU/N counts, signed cases, GR, and derived `on_time` |
| `v_monthly_consultant_gr` / `v_yearly_consultant_gr` | Active GR and APE aggregated over `date_submitted` |
| `v_case_totals` | Active and cancelled counts side by side |
| `v_case_mix_by_category` | Counts and APE per policy type — reproduces the old workbook's cross-tab |
| `v_pending_inception` | Active cases with no inception date yet |
| `v_target_shortfall` | Current month and year targets, shortfall and achievement |
| `v_missing_submissions` | Who has not submitted today |
| `missing_submissions(date)` | Same for any date — drives the reminders |
| `team_daily(date)` | Every active person for a date, submitted or not |
| `monthly_compliance(year, month)` | Required, submitted, on-time, late and missing days |

Date-parameterised reports are functions rather than views because a view cannot take an argument. They default to `sg_today()`.

Nothing stores a calculated total. The dashboard and the Excel export read these same objects, which is what stops the two disagreeing.

## Rules worth restating

- **`on_time` is derived, never stored.** It compares `first_submitted_at` to that date's deadline. A later correction to an originally on-time submission therefore stays on time, automatically.
- **GR is derived from active cases only**, aggregated over `date_submitted`. There is no GR column on `daily_submissions` — a second editable GR field would inevitably disagree with the cases behind it.
- **Required days for the current month are the days elapsed**, so a consultant who has submitted every day reads 100% on the 12th rather than 40%.
- **"Not in the future" is not a CHECK constraint.** Postgres requires CHECK expressions to be immutable and `now()` is not, so it is enforced by the RLS write policy through `within_edit_window()`.

## Accounts

There is no public sign-up. Create users in the Supabase dashboard under **Authentication → Users → Add user**; the `on_auth_user_created` trigger creates the matching profile automatically, reading `full_name` and `role` from user metadata and defaulting to `consultant`.

To promote someone:

```sql
update public.profiles set role = 'admin' where email = 'director@yourdomain.com';
```

When someone leaves, set `active = false`. That stops their reminders and removes them from missing lists while leaving every historical figure intact.

See `supabase/seed.sql` for worked examples of setting targets.
