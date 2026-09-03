-- ===========================================================================
-- Atlas DART - a second, punctual scheduler for the reminders
-- ===========================================================================
--
-- Paste the whole thing into the Supabase SQL editor and run it once.
--
-- WHY
-- The reminders are driven by GitHub Actions. GitHub's scheduler is
-- best-effort and, in practice, unreliable: over the fortnight to 1 September
-- it delivered about 190 of an expected 245 runs, arriving 15-40 minutes late
-- as a rule and occasionally hours late. On 25 August the evening chase ran
-- all twelve of its hours; on 29, 30 and 31 August it managed about five. That
-- is why reminders arrive at unpredictable times.
--
-- This adds a SECOND scheduler inside Supabase, which keeps proper time. It
-- does not replace GitHub - both call the same functions, and whichever
-- arrives first does the work:
--
--   * Every send is written to reminder_logs under a unique
--     (user_id, business_date, reminder_type) key, so the second caller finds
--     the row already there and sends nothing.
--   * Each function now refuses to run outside its own window, so a late
--     caller of either kind is dropped rather than notifying people at the
--     wrong hour.
--
-- Two schedulers with one idempotent target is strictly better than one
-- unreliable scheduler. If GitHub misses 7 PM, Supabase still fires it.
--
-- SAFE TO RE-RUN. Existing jobs of the same name are replaced, not duplicated.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Preconditions
-- ---------------------------------------------------------------------------
-- pg_cron schedules; pg_net makes the outbound HTTPS call. Both ship with
-- Supabase and are free. Creating an extension that already exists is a no-op.

create extension if not exists pg_cron;
create extension if not exists pg_net;


-- ---------------------------------------------------------------------------
-- 2. The shared token
-- ---------------------------------------------------------------------------
-- The reminder functions require REMINDER_TEST_TOKEN from every caller. It is
-- kept in Vault, which encrypts it at rest, rather than written into a job
-- definition where it would sit in plain text in cron.job for anyone with
-- database access to read.
--
-- >>> REPLACE THE VALUE BELOW with the same string that is in Netlify's
-- >>> environment variables and in the GitHub repository secret. All three
-- >>> must match exactly.

select vault.create_secret(
  'PASTE_THE_REMINDER_TEST_TOKEN_HERE',
  'atlas_dart_reminder_token',
  'Shared token the reminder functions require from every caller'
)
where not exists (
  select 1 from vault.secrets where name = 'atlas_dart_reminder_token'
);


-- ---------------------------------------------------------------------------
-- 3. One place that knows how to call a reminder
-- ---------------------------------------------------------------------------
-- Rather than repeating the URL and the header in four job definitions, the
-- jobs call this. Changing the site address later means changing one line.

create or replace function public.call_reminder(fn text)
returns bigint
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  token text;
  request_id bigint;
begin
  select decrypted_secret into token
    from vault.decrypted_secrets
   where name = 'atlas_dart_reminder_token';

  if token is null then
    raise exception
      'atlas_dart_reminder_token is not in Vault - section 2 of this script was not run';
  end if;

  -- The token goes in a header, never the query string: a query string is
  -- written to Netlify's request logs.
  select net.http_get(
           url     := 'https://atlasdartibw.netlify.app/.netlify/functions/' || fn,
           headers := jsonb_build_object(
                        'Authorization', 'Bearer ' || token,
                        'Content-Type',  'application/json'
                      ),
           timeout_milliseconds := 120000
         )
    into request_id;

  return request_id;
end;
$$;

revoke all on function public.call_reminder(text) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. The schedule
-- ---------------------------------------------------------------------------
-- pg_cron runs in UTC, like GitHub. Singapore is UTC+8 year-round.
--
--   0 11-22 * * *   hourly 19:00-06:00   the DART chase
--   0 0,11  * * *   08:00 and 19:00      coaching
--   0 13    * * *   21:00                the email nudge
--   0 22    * * *   06:00                the admin digest
--
-- cron.schedule replaces a job of the same name, so re-running this section
-- updates the schedule instead of creating a second copy.

select cron.schedule(
  'atlas-dart-push-reminders', '0 11-22 * * *',
  $$select public.call_reminder('push-reminders')$$
);

select cron.schedule(
  'atlas-dart-coaching-reminders', '0 0,11 * * *',
  $$select public.call_reminder('coaching-reminders')$$
);

select cron.schedule(
  'atlas-dart-reminder-consultants', '0 13 * * *',
  $$select public.call_reminder('reminder-consultants')$$
);

select cron.schedule(
  'atlas-dart-reminder-admin-digest', '0 22 * * *',
  $$select public.call_reminder('reminder-admin-digest')$$
);


-- ---------------------------------------------------------------------------
-- 5. What you should see
-- ---------------------------------------------------------------------------
-- Four rows, all active, with the crons above.

select jobname, schedule, active
  from cron.job
 where jobname like 'atlas-dart-%'
 order by jobname;


-- ===========================================================================
-- AFTERWARDS
--
-- Check it is firing (run this an hour or so later):
--
--   select j.jobname, r.status, r.start_time, r.return_message
--     from cron.job_run_details r
--     join cron.job j on j.jobid = r.jobid
--    where j.jobname like 'atlas-dart-%'
--    order by r.start_time desc
--    limit 20;
--
-- `status = 'succeeded'` means the call was DISPATCHED. What the function
-- replied is in reminder_logs, which is the real answer:
--
--   select business_date,
--          count(*) filter (where status = 'sent')   as sent,
--          count(*) filter (where status = 'failed') as failed
--     from public.reminder_logs
--    where business_date >= public.sg_today() - 7
--    group by business_date
--    order by business_date desc;
--
-- TO STOP IT AGAIN
--
--   select cron.unschedule('atlas-dart-push-reminders');
--   select cron.unschedule('atlas-dart-coaching-reminders');
--   select cron.unschedule('atlas-dart-reminder-consultants');
--   select cron.unschedule('atlas-dart-reminder-admin-digest');
-- ===========================================================================
