-- ===========================================================================
-- Atlas DART - why did the reminder not arrive?
-- ===========================================================================
--
-- READ-ONLY. Paste into the Supabase SQL editor and run. Changes nothing.
--
-- The hourly chase can go quiet in five different places, and they need
-- different fixes. Each section below rules one of them in or out, in the
-- order worth checking. The first section that says STOP is your answer.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Was a reminder even DUE?
--
-- Submitting removes you from the list. That is the whole design - the chase
-- stops when the day is in. If you had already submitted, silence is correct
-- and nothing is broken.
-- ---------------------------------------------------------------------------
select
  '1. WAS ANYTHING DUE'                            as check,
  p.full_name,
  case
    when d.status = 'submitted'
      then 'Nothing due - already submitted at ' ||
           to_char(d.first_submitted_at at time zone 'Asia/Singapore', 'HH12:MI AM')
    when d.status = 'draft'
      then 'DUE - a draft is not a submission, the chase should have run'
    else 'DUE - nothing recorded for today'
  end                                              as verdict
from public.profiles p
left join public.daily_submissions d
  on d.user_id = p.id and d.business_date = public.sg_today()
where p.active
order by p.full_name;

-- ---------------------------------------------------------------------------
-- 2. Is there a device to send to at all?
--
-- "Enable notifications" has to have written a row here. Permission granted
-- in the browser but no row means the subscription never reached the server.
--
-- failure_count >= 5 means the row is being SKIPPED: that endpoint refused
-- five times, so the sender gave up on it. A stale device, or one from the
-- old address before the site was renamed, ends up here.
-- ---------------------------------------------------------------------------
select
  '2. DEVICES'                                     as check,
  p.full_name,
  count(s.id)                                      as devices,
  count(s.id) filter (where s.failure_count < 5)   as usable,
  count(s.id) filter (where s.failure_count >= 5)  as given_up_on,
  case
    when count(s.id) = 0
      then 'STOP - no device registered. Open the app and tap Enable notifications.'
    when count(s.id) filter (where s.failure_count < 5) = 0
      then 'STOP - every device has failed 5+ times and is now skipped. Run reset-push-subscriptions.sql, then re-enable.'
    else 'OK - ' || count(s.id) filter (where s.failure_count < 5) || ' usable device(s)'
  end                                              as verdict
from public.profiles p
left join public.push_subscriptions s on s.user_id = p.id
where p.active
group by p.full_name
order by p.full_name;

-- ---------------------------------------------------------------------------
-- 3. Did the sender RUN, and what happened?
--
-- Every attempt writes a row here, success or failure, with the error text.
--
--   rows present, status 'sent'    -> it sent. The problem is on the device.
--   rows present, status 'failed'  -> read error_message; that is your answer.
--   NO ROWS AT ALL                 -> the function never got as far as trying.
--                                     Either the schedule is not firing, or it
--                                     threw before sending - see section 5.
-- ---------------------------------------------------------------------------
select
  '3. SEND ATTEMPTS (last 3 days)'                 as check,
  p.full_name,
  r.business_date,
  r.reminder_type,
  r.status,
  to_char(r.sent_at at time zone 'Asia/Singapore', 'DD Mon HH12:MI AM') as attempted_sgt,
  coalesce(r.error_message, '-')                   as error
from public.reminder_logs r
join public.profiles p on p.id = r.user_id
where r.business_date >= public.sg_today() - 2
order by r.sent_at desc
limit 60;

-- ---------------------------------------------------------------------------
-- 4. If section 3 was EMPTY, was it empty for everyone?
--
-- A single count. Zero across the board means the scheduled function is not
-- running at all, which is a Netlify question, not a database one.
-- ---------------------------------------------------------------------------
select
  '4. IS THE SCHEDULE FIRING'                      as check,
  count(*)                                         as attempts_last_3_days,
  count(*) filter (where reminder_type like 'push\_%') as push_attempts,
  coalesce(
    to_char(max(sent_at) at time zone 'Asia/Singapore', 'DD Mon YYYY, HH12:MI AM'),
    'never'
  )                                                as last_attempt_sgt,
  case
    when count(*) = 0
      then 'STOP - the sender has not run at all. Check Netlify > Functions > push-reminders for its log, and that VAPID_PRIVATE_KEY and NEXT_PUBLIC_VAPID_PUBLIC_KEY are set.'
    when count(*) filter (where reminder_type like 'push\_%') = 0
      then 'STOP - email reminders ran but PUSH never did. Almost always a missing VAPID key.'
    else 'OK - the schedule is firing'
  end                                              as verdict
from public.reminder_logs
where business_date >= public.sg_today() - 2;

-- ---------------------------------------------------------------------------
-- 5. What the schedule actually is
--
-- For comparison with what you expected. These hours are fixed in the code,
-- not configurable per person - the Reminders screen displays them, it does
-- not set them.
-- ---------------------------------------------------------------------------
select
  '5. THE SCHEDULE'                                as check,
  public.sg_today()                                as singapore_date_now,
  to_char(now() at time zone 'Asia/Singapore', 'HH12:MI AM') as singapore_time_now,
  '7 PM first, then hourly to 11 PM, deadline 11:59 PM, then hourly and SILENT until 6 AM' as chase,
  'Silent overnight means it waits on the lock screen - it will not make a sound or wake you' as note;
