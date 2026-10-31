-- ===========================================================================
-- Atlas DART - quieten the evening chase
-- ===========================================================================
--
-- Paste the whole thing into the Supabase SQL editor and run it once.
--
-- NO TOKEN NEEDED. This only changes WHEN the reminders run. The token in
-- Vault and the call_reminder function are left exactly as they are, which is
-- why this is a separate script rather than a re-run of
-- enable-pg-cron-reminders.sql.
--
-- WHAT CHANGES
-- The chase ran every hour from 7 PM to 6 AM. Someone who forgot got twelve
-- notifications in a night, seven of them between midnight and dawn. Past
-- about the third, a reminder is not a reminder - it is the reason someone
-- turns notifications off, and a muted phone cannot be chased at all.
--
--   BEFORE  7, 8, 9, 10, 11 PM, then midnight, 1, 2, 3, 4, 5, 6 AM   (12)
--   AFTER   7, 9, 11, 11:59 PM, then 6 AM                            (5)
--
-- Four audible notifications two hours apart, then one silent one at 6 AM
-- about yesterday - timed to land just before the admin digest, so it is the
-- last chance to fix it before someone else sees the list.
--
-- SAFE TO RE-RUN. cron.schedule replaces a job of the same name.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Retire the hourly job
-- ---------------------------------------------------------------------------
-- This is the step that actually stops the nagging. The five new jobs below
-- have new names, so without this the old hourly job stays active alongside
-- them and the night is louder than before, not quieter.
--
-- cron.unschedule(text) throws if the job does not exist, so this reads
-- cron.job first - that way the script survives being run twice.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'atlas-dart-push-reminders') then
    perform cron.unschedule('atlas-dart-push-reminders');
    raise notice 'Retired the hourly job atlas-dart-push-reminders.';
  else
    raise notice 'atlas-dart-push-reminders is already gone - nothing to retire.';
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- 2. The five slots
-- ---------------------------------------------------------------------------
-- pg_cron runs in UTC. Singapore is UTC+8 year-round.
--
--   0 11  * * *   19:00 SGT   firm      "closes at 11:59, takes two minutes"
--   0 13  * * *   21:00 SGT   urgent    "submit before you forget"
--   0 15  * * *   23:00 SGT   final     "last call"
--   59 15 * * *   23:59 SGT   deadline  "closing now"
--   0 22  * * *   06:00 SGT   overdue   silent, and about yesterday
--
-- One job per slot, rather than one job with a multi-hour cron, because the
-- 11:59 slot needs a parameter the others must not get - see section 3.

select cron.schedule(
  'atlas-dart-push-1900', '0 11 * * *',
  $$select public.call_reminder('push-reminders')$$
);

select cron.schedule(
  'atlas-dart-push-2100', '0 13 * * *',
  $$select public.call_reminder('push-reminders')$$
);

select cron.schedule(
  'atlas-dart-push-2300', '0 15 * * *',
  $$select public.call_reminder('push-reminders')$$
);

-- ---------------------------------------------------------------------------
-- 3. The final call, which needs a name of its own
-- ---------------------------------------------------------------------------
-- 11:00 PM and 11:59 PM are both hour 23, and the key the function writes to
-- reminder_logs is built from the hour. Without ?slot=deadline both runs key
-- on push_23: the 11:59 call finds the 11 PM row already there and skips
-- itself as a duplicate of the thing it is meant to follow. It would never
-- have sent, and nothing would have looked broken.
--
-- This slot is also the one that cannot run late. It says "closing now", and
-- at 00:20 nothing is closing - so the function refuses to send it outside
-- hour 23. pg_cron fires on the minute, which is what makes it work;
-- GitHub Actions is routinely 15-40 minutes behind and its copy of this slot
-- will usually arrive after midnight and be dropped. That is the intended
-- behaviour, not a fault: anyone missed is picked up by the 6 AM run.

select cron.schedule(
  'atlas-dart-push-2359', '59 15 * * *',
  $$select public.call_reminder('push-reminders', 'slot=deadline')$$
);

-- 6 AM: silent, about yesterday, and the last chance before the admin digest
-- goes out on the same minute.
select cron.schedule(
  'atlas-dart-push-0600', '0 22 * * *',
  $$select public.call_reminder('push-reminders')$$
);


-- ---------------------------------------------------------------------------
-- 4. Check it
-- ---------------------------------------------------------------------------
-- The Supabase SQL editor shows only the LAST statement's result, so the
-- verdict is deliberately last and the job list is folded into it.
--
-- Expected: 8 jobs - five push slots, coaching, the email nudge, the digest -
-- and NO hourly job left.

with expected as (
  select unnest(array[
    'atlas-dart-push-1900',
    'atlas-dart-push-2100',
    'atlas-dart-push-2300',
    'atlas-dart-push-2359',
    'atlas-dart-push-0600',
    'atlas-dart-coaching-reminders',
    'atlas-dart-reminder-consultants',
    'atlas-dart-reminder-admin-digest'
  ]) as jobname
),
state as (
  select
    (select count(*) from expected e
       join cron.job j on j.jobname = e.jobname and j.active) as ready,
    (select count(*) from cron.job
      where jobname = 'atlas-dart-push-reminders')            as hourly_left,
    (select string_agg(e.jobname, ', ' order by e.jobname)
       from expected e
      where not exists (
        select 1 from cron.job j where j.jobname = e.jobname and j.active
      ))                                                      as missing
)
select
  ready      as active_jobs,
  missing,
  case
    when hourly_left > 0
      then 'STOP - the hourly job is still scheduled. Section 1 did not run, and the night is now louder, not quieter.'
    when ready = 8
      then 'OK - 8 jobs active, hourly job retired. Tonight: 7, 9, 11, 11:59 PM, then a silent one at 6 AM.'
    else 'STOP - some jobs are missing or inactive. See the missing column.'
  end as verdict
from state;


-- ===========================================================================
-- AFTERWARDS
--
-- Tomorrow morning, confirm the night ran as intended. Five rows per person
-- at most, and the reminder_type column says which slot each one was:
--
--   select reminder_type,
--          count(*) filter (where status = 'sent')   as sent,
--          count(*) filter (where status = 'failed') as failed
--     from public.reminder_logs
--    where business_date = public.sg_today() - 1
--    group by reminder_type
--    order by reminder_type;
--
-- push_19, push_21, push_23, push_deadline, push_6. If push_deadline is
-- missing, the 11:59 call was late rather than broken - check that
-- atlas-dart-push-2359 ran:
--
--   select j.jobname, r.status, r.start_time, r.return_message
--     from cron.job_run_details r
--     join cron.job j on j.jobid = r.jobid
--    where j.jobname = 'atlas-dart-push-2359'
--    order by r.start_time desc
--    limit 5;
--
-- TO GO BACK TO HOURLY (not recommended)
--
--   select cron.unschedule(jobname) from cron.job
--    where jobname like 'atlas-dart-push-%';
--   select cron.schedule('atlas-dart-push-reminders', '0 11-22 * * *',
--     $$select public.call_reminder('push-reminders')$$);
-- ===========================================================================
