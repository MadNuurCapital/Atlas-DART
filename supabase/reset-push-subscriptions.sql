-- ===========================================================================
-- Atlas DART - clear push subscriptions after a domain change
-- ===========================================================================
--
--   Run this ONCE, after the site moved to a new address.
--   Everyone then taps "Enable notifications" again. Nothing else is touched.
--
-- WHY THIS IS NEEDED
-- A push subscription belongs to the exact origin that created it. When the
-- site moved from dart-casetrackeribw.netlify.app to atlasdartibw.netlify.app,
-- every existing row became a subscription against an address that no longer
-- serves the app.
--
-- Those rows do not stop working, which is the awkward part. The notification
-- still arrives - and tapping it opens the old address, which is now dead.
-- Meanwhile the app on the new address sees no subscription for its own
-- origin, so it shows notifications as switched off and offers to enable them.
-- Accepting that writes a SECOND row. The result is a person receiving two
-- notifications, one of which leads nowhere.
--
-- Deleting all of them is simplest and safest: the endpoint issued by Google
-- or Apple looks identical whichever origin asked for it, so there is no way
-- to tell an old row from a new one by inspection.
--
-- WHAT THIS DOES NOT TOUCH
-- Accounts, roles, targets, insurers, submissions, cases, coaching and the
-- audit trail are all left exactly as they are. This is only the list of
-- browsers that have agreed to receive notifications.
--
-- AFTER RUNNING IT
--   1. Everyone opens the app at the NEW address and taps Enable notifications.
--   2. iPhone users must first delete the old Home Screen icon and re-add from
--      the new address. iOS ties web push to the installed origin, so tapping
--      Enable inside the old icon will re-subscribe to the old address again.
-- ===========================================================================

begin;

-- Same precondition as the pre-launch reset, for the same reason. Every table
-- has FORCE ROW LEVEL SECURITY, so a role without BYPASSRLS deletes nothing
-- and reports success. Checked before anything is touched, because such a role
-- cannot SELECT these rows either and every count afterwards would read zero.
do $$
begin
  if not (select rolbypassrls from pg_roles where rolname = current_user) then
    raise exception
      E'CANNOT RUN AS %.\nThis role is bound by FORCE ROW LEVEL SECURITY, so the delete would remove nothing while appearing to succeed.\nRun this in the Supabase SQL editor, which connects as `postgres`.',
      current_user;
  end if;
end $$;

-- Who is about to lose their subscription, so the run leaves a record of who
-- needs telling.
select p.full_name,
       p.email,
       count(s.id) as devices_to_re_enable
from public.profiles p
join public.push_subscriptions s on s.user_id = p.id
group by p.full_name, p.email
order by p.full_name;

delete from public.push_subscriptions;

do $$
declare
  remaining bigint;
  people    bigint;
begin
  select count(*) into remaining from public.push_subscriptions;
  if remaining > 0 then
    raise exception 'RESET DID NOT COMPLETE - % subscription(s) survived. Nothing has been changed.', remaining;
  end if;

  -- Prove the delete stayed inside its lane.
  select count(*) into people from public.profiles;
  if people = 0 then
    raise exception 'RESET OVERREACHED - profiles is empty. Rolling back.';
  end if;

  raise notice 'All push subscriptions cleared. % account(s) untouched - each taps Enable notifications again on the new address.', people;
end $$;

commit;

-- Confirm nothing else moved.
select 'push_subscriptions' as table_name, count(*) as rows from public.push_subscriptions
union all select 'profiles',            count(*) from public.profiles
union all select 'consultant_targets',  count(*) from public.consultant_targets
union all select 'insurers',            count(*) from public.insurers
union all select 'daily_submissions',   count(*) from public.daily_submissions
union all select 'cases',               count(*) from public.cases
union all select 'coaching_sessions',   count(*) from public.coaching_sessions
order by table_name;
