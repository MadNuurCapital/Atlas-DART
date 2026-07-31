# Netlify deployment

GitHub → Netlify continuous deployment. Supabase provides the database and auth. Netlify holds the secrets.

## One-time setup

### 1. Supabase

1. Create a project. Choose the **Singapore** region — the team is there, and the round trip on every request is the difference between a form that feels instant and one that does not.
2. Apply the migrations in order:
   ```bash
   supabase link --project-ref <ref>
   supabase db push
   ```
   Or paste each file from `supabase/migrations/` into the SQL editor, in filename order.
3. Copy the project URL and both keys from **Settings → API**. Current Supabase naming is publishable (`sb_publishable_…`) and secret (`sb_secret_…`), replacing the legacy anon/service_role names.
4. Confirm Realtime is enabled for `daily_submissions`, `appointment_activities` and `cases`. Migration `0013_realtime.sql` adds them to the publication; **Database → Replication** shows the result.

### 2. Admin accounts

**Authentication → Users → Add user**, one for the director and one for Muhammad. Set `full_name` and `role: admin` in user metadata, then:

```sql
update public.profiles set role = 'admin' where email = 'director@yourdomain.com';
```

The `on_auth_user_created` trigger creates the profile row automatically. There is no public sign-up and no shared admin password.

### 3. Resend

1. Verify a sending domain. An unverified domain silently lands in spam.
2. Create an API key.
3. Consider pointing Supabase's SMTP settings at the same Resend account — Supabase's built-in sender is rate-limited to a handful of emails per hour and is not for production, which matters when inviting the whole team at once.

### 4. Netlify

Connect the repository. The build settings come from `netlify.toml`; nothing needs configuring in the UI.

The Next.js Runtime v5 is auto-detected. Do **not** install `@netlify/plugin-nextjs` manually or add a legacy adapter — a pinned plugin fights the built-in runtime.

## Environment variables

**Site settings → Environment variables.** All six are required; the app fails loudly rather than silently misbehaving if one is missing.

| Variable | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | All | Public |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | All | Public. Safe in the browser — RLS filters everything it can read. |
| `SUPABASE_SECRET_KEY` | Functions | **Bypasses RLS.** Never expose to the browser. |
| `RESEND_API_KEY` | Functions | |
| `REMINDER_FROM_EMAIL` | Functions | `DART Tracker <dart@yourdomain.com>` |
| `APP_URL` | All | Used for links inside reminder emails |
| `REMINDER_TEST_TOKEN` | Functions | Guards the manual reminder trigger |

`src/lib/supabase/admin.ts` imports `server-only`, so importing the secret key into a client component is a build error rather than a runtime leak. A test additionally scans the built client bundle for it.

## Scheduled functions

Declared in the function files themselves via `export const config = { schedule }`, not in `netlify.toml` and not as legacy scheduled API routes.

| Function | Cron (UTC) | Singapore | Needs |
|---|---|---|---|
| `push-reminders` | `0 11-22 * * *` | hourly 19:00–06:00 | VAPID keys |
| `reminder-consultants` | `0 13 * * *` | 21:00 | Resend — skips itself without it |
| `reminder-admin-digest` | `0 22 * * *` | 06:00 | VAPID keys; Resend optional |
| `coaching-reminders` | `0 0,11 * * *` | 08:00 and 19:00 | VAPID keys |

They appear under **Functions** after the first deploy. See [`reminder-function.md`](reminder-function.md) for how to test them before letting the crons run unattended — **Netlify Dev does not fire crons**.

## Verifying a deploy

1. Sign in as an admin.
2. Submit a day as a consultant on a real phone; confirm it appears on `/admin/daily` **without refreshing** — that exercises Realtime, which is the piece most likely to be misconfigured.
3. Add a case, check GR moves on the dashboard, cancel it, check GR drops and the row survives.
4. Download a monthly export and confirm seven sheets with real numeric cells.
5. Trigger the reminder functions with `dryRun=true` and check the names are who you expect.
6. Book a coaching session for yourself and confirm it appears on your dashboard and nowhere else.

## Rollback

Netlify keeps every deploy. **Deploys → select a previous one → Publish deploy** reverts the site in seconds.

Database migrations do **not** roll back with it. Nothing in `supabase/migrations/` is destructive — no column is dropped and no data deleted — so an older build runs against a newer schema safely. Keep it that way: if a future migration needs to remove something, ship the code change first and the removal in a later release.

## Cost note

Supabase pauses free-tier projects after a week of inactivity. A paused database means a login screen that hangs. For a team relying on this daily, use a paid tier.
