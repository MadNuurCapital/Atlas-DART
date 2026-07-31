-- ===========================================================================
-- Atlas DART - clear the testing period before the team starts
-- ===========================================================================
--
--   THIS DELETES DATA AND CANNOT BE UNDONE.
--   Take a Supabase backup first: Database > Backups > Create backup.
--
-- Run `reset-before-launch-preview.sql` FIRST. It is read-only and shows
-- exactly what this will remove and what it will leave alone.
--
-- WHAT THIS CLEARS
--   daily_submissions          every DART entry
--   appointment_activities     every prospect row
--   cases                      every case, cancelled ones included
--   coaching_sessions          every session and request
--   coaching_notes             admin-only notes on those sessions
--   coaching_reminders_sent    coaching notification bookkeeping
--   reminder_logs              nightly-chase bookkeeping
--   audit_logs                 the change trail from the build and testing
--
-- WHAT THIS KEEPS
--   profiles                   everyone's login and role
--   consultant_targets         the GR targets already set
--   insurers                   the insurer list, including any added
--   push_subscriptions         notification sign-ups - nobody re-enables
--
-- WHY A SCRIPT AND NOT A BUTTON
-- The application has no delete path anywhere, on purpose: there is no DELETE
-- policy on `cases` at all, so Postgres itself refuses one. Decision D15. A
-- deliberate reset therefore has to happen here, once, by hand.
--
-- THE FAILURE THIS GUARDS AGAINST
-- Every table has FORCE ROW LEVEL SECURITY, which binds even the table owner.
-- A DELETE from a role without BYPASSRLS removes nothing AND raises no error -
-- it just reports success having done nothing. So this script counts the rows
-- afterwards and aborts the whole transaction if any survived, rather than
-- letting you believe a reset happened that did not.
--
-- Supabase's SQL editor runs as `postgres`, which has BYPASSRLS, so this works
-- there. It is the guard that makes that a checked fact rather than a hope.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Precondition, checked before anything is touched.
--
-- This has to be up front rather than left to the verification at the end. A
-- role bound by RLS cannot SELECT these rows either, so every count after the
-- deletes would read zero and the run would look like a success. Checking the
-- privilege directly is the only test that gives the true answer.
-- ---------------------------------------------------------------------------
do $$
begin
  if not (select rolbypassrls from pg_roles where rolname = current_user) then
    raise exception
      E'CANNOT RUN AS %.\nThis role is bound by FORCE ROW LEVEL SECURITY, so the deletes would remove nothing while appearing to succeed.\nRun this in the Supabase SQL editor, which connects as `postgres`.',
      current_user;
  end if;
end $$;

-- Children before parents. Most of these cascade anyway, but naming each one
-- means the verification below covers it explicitly.
delete from public.appointment_activities;
delete from public.daily_submissions;
delete from public.cases;
delete from public.coaching_notes;
delete from public.coaching_reminders_sent;
delete from public.coaching_sessions;
delete from public.reminder_logs;

-- Last, so that if anything above failed the trail still records the attempt.
delete from public.audit_logs;

-- ---------------------------------------------------------------------------
-- Verify. Any failure raises, which rolls the whole transaction back.
-- ---------------------------------------------------------------------------
do $$
declare
  stragglers text := '';
  n bigint;
  t text;
begin
  foreach t in array array[
    'appointment_activities', 'daily_submissions', 'cases',
    'coaching_notes', 'coaching_reminders_sent', 'coaching_sessions',
    'reminder_logs', 'audit_logs'
  ] loop
    execute format('select count(*) from public.%I', t) into n;
    if n > 0 then
      stragglers := stragglers || format('  %s still has %s row(s)%s', t, n, chr(10));
    end if;
  end loop;

  if stragglers <> '' then
    raise exception E'RESET DID NOT COMPLETE - nothing has been changed.\n%', stragglers;
  end if;

  -- The other half: prove the reset did not take anything it should not have.
  -- The precondition above rules out RLS hiding these, so an empty profiles
  -- here means the deletes genuinely reached further than intended.
  select count(*) into n from public.profiles;
  if n = 0 then
    raise exception 'RESET OVERREACHED - profiles is empty. Rolling back.';
  end if;

  raise notice 'Reset complete. % account(s) kept, with their targets, insurers and notification sign-ups.', n;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- What you are left with.
-- ---------------------------------------------------------------------------
select 'profiles'          as kept, count(*) as rows from public.profiles
union all select 'consultant_targets', count(*) from public.consultant_targets
union all select 'insurers',           count(*) from public.insurers
union all select 'push_subscriptions', count(*) from public.push_subscriptions
order by kept;
