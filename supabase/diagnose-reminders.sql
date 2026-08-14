-- ===========================================================================
-- Atlas DART - why did the reminder not arrive?
-- ===========================================================================
--
-- READ-ONLY. Paste the whole thing into the Supabase SQL editor and run.
-- It changes nothing.
--
-- ONE query on purpose. The SQL editor only shows the result of the LAST
-- statement, so a script of separate SELECTs displays only its final section
-- and silently hides the rest - which is exactly what happened the first time.
-- Everything below arrives as a single table instead.
--
-- Read the `verdict` column top to bottom. The first STOP is your answer.
-- ===========================================================================

with

-- Who is being chased today, and whether anything was due for them at all.
due as (
  select
    p.id,
    p.full_name,
    d.status as submission_status,
    d.first_submitted_at
  from public.profiles p
  left join public.daily_submissions d
    on d.user_id = p.id and d.business_date = public.sg_today()
  where p.active
),

-- Devices, split into the ones that would be used and the ones given up on.
devices as (
  select
    p.id,
    count(s.id)                                     as total,
    count(s.id) filter (where s.failure_count < 5)  as usable,
    count(s.id) filter (where s.failure_count >= 5) as dead
  from public.profiles p
  left join public.push_subscriptions s on s.user_id = p.id
  where p.active
  group by p.id
),

-- What the sender actually did over the last three days.
attempts as (
  select
    count(*)                                                   as total,
    count(*) filter (where reminder_type like 'push\_%')        as push,
    count(*) filter (where status = 'sent')                    as sent,
    count(*) filter (where status = 'failed')                  as failed,
    max(sent_at)                                               as last_at
  from public.reminder_logs
  where business_date >= public.sg_today() - 2
),

-- The same, over all time. Three days cannot tell "never worked" apart from
-- "worked once and stopped", and those need completely different fixes.
ever as (
  select
    count(*)                                            as total,
    count(*) filter (where reminder_type like 'push\_%') as push,
    coalesce(min(business_date)::text, '-')             as first_day,
    coalesce(max(business_date)::text, '-')             as last_day
  from public.reminder_logs
),

report as (

  -- 0. Where and when we are, so the rest has context.
  select 1 as ord, '0. RIGHT NOW' as step, 'Singapore' as subject,
         public.sg_today()::text || ', ' ||
           to_char(now() at time zone 'Asia/Singapore', 'HH12:MI AM') as detail,
         'The chase runs 7 PM - 6 AM Singapore. Outside those hours nothing is due.' as verdict

  -- 1. Was a reminder due at all? Submitting stops the chase, by design.
  union all
  select 2, '1. WAS IT DUE', d.full_name,
         coalesce(d.submission_status, 'nothing recorded'),
         case
           when d.submission_status = 'submitted'
             then 'NOT DUE - already submitted at ' ||
                  to_char(d.first_submitted_at at time zone 'Asia/Singapore', 'HH12:MI AM') ||
                  '. Silence is correct.'
           when d.submission_status = 'draft'
             then 'DUE - a draft is not a submission. The chase should have run.'
           else 'DUE - nothing recorded today. The chase should have run.'
         end
  from due d

  -- 2. Is there a device that would actually be sent to?
  union all
  select 3, '2. DEVICES', d.full_name,
         v.total || ' registered, ' || v.usable || ' usable, ' || v.dead || ' given up on',
         case
           when v.total = 0
             then 'STOP - no device registered. Open the app and tap Enable notifications.'
           when v.usable = 0
             then 'STOP - every device failed 5+ times and is now skipped. Run reset-push-subscriptions.sql, then re-enable on the new address.'
           else 'OK - ' || v.usable || ' device(s) would be sent to'
         end
  from due d join devices v on v.id = d.id

  -- 3. Did the sender run, and what came back?
  union all
  select 4, '3. SENDER', 'last 3 days',
         a.total || ' attempts (' || a.push || ' push, ' ||
           a.sent || ' sent, ' || a.failed || ' failed)',
         case
           when a.total = 0
             then 'STOP - the sender has not run at all. Check Netlify > Functions > push-reminders, and that VAPID_PRIVATE_KEY and NEXT_PUBLIC_VAPID_PUBLIC_KEY are both set.'
           when a.push = 0
             then 'STOP - something ran but PUSH never did. Almost always a missing VAPID key.'
           when a.sent = 0
             then 'STOP - every attempt failed. The reason is in the rows below.'
           else 'OK - the schedule is firing and ' || a.sent || ' notification(s) went out'
         end
  from attempts a

  union all
  select 5, '3. SENDER', 'last attempt',
         coalesce(to_char(a.last_at at time zone 'Asia/Singapore', 'DD Mon YYYY, HH12:MI AM'), 'never'),
         case when a.last_at is null
              then 'Never sent anything. See the STOP above.'
              else 'Compare this against the 7 PM - 6 AM schedule.' end
  from attempts a

  union all
  select 5, '3. SENDER', 'all time',
         e.total || ' attempts ever (' || e.push || ' push), ' ||
           case when e.total = 0 then 'none'
                else e.first_day || ' to ' || e.last_day end,
         case
           when e.total = 0
             then 'STOP - the sender has NEVER run, not once since the app went live. Enabling notifications does not start it: this is Netlify, not the database.'
           when e.push = 0
             then 'STOP - it has run, but never sent a push. A VAPID key is the usual cause.'
           else 'It has worked before. Compare the last day above against when things changed.'
         end
  from ever e

  -- 4. The individual failures, with the error the push service returned.
  union all
  select 6, '4. FAILURES', p.full_name,
         r.reminder_type || ' on ' || r.business_date::text,
         'FAILED: ' || coalesce(r.error_message, 'no reason recorded')
  from public.reminder_logs r
  join public.profiles p on p.id = r.user_id
  where r.business_date >= public.sg_today() - 2
    and r.status = 'failed'

  -- 5. The successes, so a working setup is visibly working.
  union all
  select 7, '5. SUCCESSES', p.full_name,
         r.reminder_type || ' on ' || r.business_date::text,
         'Sent ' || to_char(r.sent_at at time zone 'Asia/Singapore', 'DD Mon HH12:MI AM') ||
           ' - if this never reached the phone, the problem is on the device.'
  from public.reminder_logs r
  join public.profiles p on p.id = r.user_id
  where r.business_date >= public.sg_today() - 2
    and r.status = 'sent'

  -- 6. Stated plainly, because it is the commonest misunderstanding.
  union all
  select 8, '6. NOTE', 'the schedule is fixed',
         '7 PM, then hourly to 11 PM, then hourly and SILENT to 6 AM',
         'There is no per-person reminder time. The Reminders screen DISPLAYS these hours, it does not set them. Overnight reminders are deliberately silent - they wait on the lock screen rather than waking the team at 3 AM.'
)

select step, subject, detail, verdict
from report
order by ord, subject;
