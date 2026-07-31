-- ===========================================================================
-- Atlas DART - preview the pre-launch reset
-- ===========================================================================
--
-- READ-ONLY. This changes nothing. Run it first, read the two tables it
-- returns, and only then run `reset-before-launch.sql`.
-- ===========================================================================

-- 1. What the reset would DELETE, and the date range it spans, so you can see
--    at a glance whether it is only the testing period.
select
  'WILL BE DELETED'                      as what,
  'daily_submissions'                    as table_name,
  count(*)                               as rows,
  coalesce(min(business_date)::text, '-') as earliest,
  coalesce(max(business_date)::text, '-') as latest
from public.daily_submissions
union all
select 'WILL BE DELETED', 'appointment_activities', count(*),
       coalesce(min(business_date)::text, '-'), coalesce(max(business_date)::text, '-')
from public.appointment_activities
union all
select 'WILL BE DELETED', 'cases', count(*),
       coalesce(min(date_submitted)::text, '-'), coalesce(max(date_submitted)::text, '-')
from public.cases
union all
select 'WILL BE DELETED', 'coaching_sessions', count(*),
       coalesce(min(scheduled_at)::date::text, '-'), coalesce(max(scheduled_at)::date::text, '-')
from public.coaching_sessions
union all
select 'WILL BE DELETED', 'coaching_notes', count(*), '-', '-' from public.coaching_notes
union all
select 'WILL BE DELETED', 'coaching_reminders_sent', count(*), '-', '-' from public.coaching_reminders_sent
union all
select 'WILL BE DELETED', 'reminder_logs', count(*),
       coalesce(min(business_date)::text, '-'), coalesce(max(business_date)::text, '-')
from public.reminder_logs
union all
select 'WILL BE DELETED', 'audit_logs', count(*),
       coalesce(min(created_at)::date::text, '-'), coalesce(max(created_at)::date::text, '-')
from public.audit_logs

union all

-- 2. What it leaves alone.
select 'WILL BE KEPT', 'profiles',           count(*), '-', '-' from public.profiles
union all
select 'WILL BE KEPT', 'consultant_targets', count(*), '-', '-' from public.consultant_targets
union all
select 'WILL BE KEPT', 'insurers',           count(*), '-', '-' from public.insurers
union all
select 'WILL BE KEPT', 'push_subscriptions', count(*), '-', '-' from public.push_subscriptions

-- Ascending puts 'WILL BE DELETED' above 'WILL BE KEPT', which is the order
-- you want to read them in.
order by what asc, table_name;

-- ---------------------------------------------------------------------------
-- 3. Who is kept, so you can confirm the team list is right before launch.
--    No data is shown beyond name, role and whether the account is active.
-- ---------------------------------------------------------------------------
select full_name, role, active,
       (select count(*) from public.push_subscriptions s where s.user_id = p.id) as devices,
       (select count(*) from public.consultant_targets t where t.consultant_id = p.id) as targets_set
from public.profiles p
order by role desc, full_name;

-- ---------------------------------------------------------------------------
-- 4. Can the role you are running as actually delete under FORCE RLS?
--    `bypasses_rls` must be true, or the reset would remove nothing and say
--    nothing. In the Supabase SQL editor it is true.
-- ---------------------------------------------------------------------------
select current_user                                as running_as,
       rolbypassrls                                as bypasses_rls,
       case when rolbypassrls then 'OK - the reset will work'
            else 'STOP - the reset would delete nothing. Use the Supabase SQL editor.'
       end                                         as verdict
from pg_roles where rolname = current_user;
