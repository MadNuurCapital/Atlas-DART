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
--
-- This block REPLACES whatever is stored, rather than skipping when a secret
-- already exists. An earlier version skipped, which meant that running the
-- script once with the placeholder still in it left the placeholder in Vault
-- permanently: every pg_cron call got a 401, and re-running the script
-- silently changed nothing. Correcting a wrong token has to be the easy path.

do $$
declare
  wanted text := 'PASTE_THE_REMINDER_TEST_TOKEN_HERE';
begin
  if wanted like 'PASTE%' or length(wanted) < 20 then
    raise exception
      'Replace the placeholder in section 2 with the real REMINDER_TEST_TOKEN, the same one that is in Netlify. Nothing has been changed.';
  end if;

  delete from vault.secrets where name = 'atlas_dart_reminder_token';

  perform vault.create_secret(
    wanted,
    'atlas_dart_reminder_token',
    'Shared token the reminder functions require from every caller'
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- 3. One place that knows how to call a reminder
-- ---------------------------------------------------------------------------
-- Rather than repeating the URL and the header in four job definitions, the
-- jobs call this. Changing the site address later means changing one line.

-- The one-argument version from an earlier run of this script must go first.
-- Postgres keeps overloads side by side, so leaving it would make every
-- call_reminder('push-reminders') ambiguous between the old (text) and the new
-- (text, text DEFAULT) - and every cron job would start erroring.
drop function if exists public.call_reminder(text);

create or replace function public.call_reminder(fn text, params text default '')
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
  -- `params` exists so a caller can pass dryRun=true. Without it the only way
  -- to exercise this path was a real run: a "safe" test call to
  -- reminder-consultants attempted to email all fifteen people at 2 PM,
  -- because that function only returns early while Resend is UNconfigured,
  -- and Resend is configured now. A test must not be able to send.
  select net.http_get(
           url     := 'https://atlasdartibw.netlify.app/.netlify/functions/'
                        || fn
                        || case when params = '' then '' else '?' || params end,
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

revoke all on function public.call_reminder(text, text) from public, anon, authenticated;


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
-- 5. Prove the token actually works, before trusting it at 7 PM
-- ---------------------------------------------------------------------------
-- Four active jobs is NOT proof the reminders will fire. The jobs can be
-- perfectly scheduled and every call still rejected, which is exactly what
-- happened the first time this script was run: the placeholder went into Vault
-- and every call came back 401, with nothing to show for it until someone
-- looked.
--
-- The test passes dryRun=true, which is the ONLY thing that makes it safe.
--
-- An earlier version called reminder-consultants bare, on the reasoning that
-- it returns early while Resend has no verified sender. Resend is configured
-- now, so it did not return early: it attempted to email all fifteen people,
-- in the middle of the afternoon, and wrote fifteen failure rows. Never test a
-- sender by letting it send.

-- The Supabase SQL editor shows only the LAST statement's result, so the
-- verdict is deliberately last. The job list is folded into it rather than
-- being its own SELECT, which would have hidden the answer.

select public.call_reminder('reminder-consultants', 'dryRun=true') as test_request_id;

-- pg_net is asynchronous, so give it a moment before reading the reply.
select pg_sleep(6);

with jobs as (
  select count(*) filter (where active) as active_jobs
    from cron.job
   where jobname like 'atlas-dart-%'
),
reply as (
  select status_code, content
    from net._http_response
   order by id desc
   limit 1
)
select
  j.active_jobs,
  r.status_code,
  case
    when j.active_jobs < 4
      then 'STOP - expected 4 active jobs. Section 4 did not run.'
    when r.status_code = 200 and r.content like '%"dryRun":true%'
      then 'OK - 4 jobs scheduled, token accepted, nothing sent. The reminders will fire.'
    when r.status_code = 200
      then 'Token accepted, but this reply is not from a dry run - read the content column before trusting it.'
    when r.status_code = 401
      then 'STOP - the token in Vault does not match the one in Netlify. Re-run section 2 with the correct value.'
    when r.status_code is null
      then 'No reply yet - re-run this final query in a few seconds.'
    else 'STOP - unexpected reply. Read the content column.'
  end as verdict,
  left(r.content, 200) as content
from jobs j
left join reply r on true;


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
