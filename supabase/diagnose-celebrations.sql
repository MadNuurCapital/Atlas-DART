-- ===========================================================================
-- Atlas DART - why did the celebration not arrive?
-- ===========================================================================
--
-- READ-ONLY. Paste the whole thing into the Supabase SQL editor and run it.
-- It changes nothing.
--
-- ONE query on purpose. The SQL editor shows only the result of the LAST
-- statement, so a script of separate SELECTs displays its final section and
-- silently hides the rest.
--
-- Read the `verdict` column top to bottom. The first STOP is the answer.
-- ===========================================================================

with

-- Is the trigger there, and is it the FIXED version from 0029? The fixed one
-- contains an exception handler; the original did not.
trig as (
  select
    count(*) filter (where t.tgname = 'cases_announce_to_team') as installed,
    coalesce(bool_or(pg_get_functiondef(p.oid) like '%exception when others%'),
             false) as has_handler
  from pg_trigger t
  join pg_proc p on p.oid = t.tgfoid
  where t.tgrelid = 'public.cases'::regclass
    and not t.tgisinternal
),

-- FORCE was the thing refusing the trigger's write.
forced as (
  select c.relforcerowsecurity as still_forced,
         c.relrowsecurity      as rls_on
  from pg_class c
  where c.oid = 'public.team_events'::regclass
),

-- Has anything actually been written?
events as (
  select
    count(*)                                              as total,
    count(*) filter (where created_at > now() - interval '2 days') as recent,
    max(created_at)                                       as newest
  from public.team_events
),

-- Cases submitted recently, and whether each got an event. This is the one
-- that separates "nothing was written" from "written but not delivered".
pairs as (
  select
    (select count(*) from public.cases)        as cases_total,
    count(*)                                   as cases_recent,
    count(e.id)                                as with_event,
    count(*) - count(e.id)                     as without_event
  from public.cases c
  left join public.team_events e on e.case_id = c.id
  where c.created_at > now() - interval '2 days'
),

-- Realtime only streams a table that is in the publication.
pub as (
  select count(*) as in_publication
  from pg_publication_tables
  where pubname = 'supabase_realtime'
    and schemaname = 'public'
    and tablename = 'team_events'
),

-- The subscribing browser reads as `authenticated`. Without SELECT it
-- receives nothing, however well everything else is configured.
grants as (
  select count(*) as can_select
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'team_events'
    and grantee = 'authenticated'
    and privilege_type = 'SELECT'
),

report as (

  select 1 as ord, '1. THE FIX' as step,
         case when t.installed = 0 then 'trigger MISSING'
              when t.has_handler then 'trigger present, 0029 applied'
              else 'trigger present, 0029 NOT applied' end as detail,
         case
           when t.installed = 0
             then 'STOP - the announcing trigger is gone. Re-run 0026 then 0029.'
           when not t.has_handler
             then 'STOP - migration 0029 has not been run. Run it: it is what lets the trigger write at all, and what stops a failure rolling back the case.'
           else 'OK - the fixed trigger is installed.'
         end as verdict
  from trig t

  union all
  select 2, '2. THE BLOCKER',
         case when f.still_forced then 'FORCE row level security is ON'
              else 'FORCE is off, RLS is ' || case when f.rls_on then 'on' else 'OFF' end end,
         case
           when f.still_forced
             then 'STOP - FORCE still binds the trigger, so it cannot write. Run 0029.'
           when not f.rls_on
             then 'STOP - RLS is off entirely on team_events. That is too open. Re-run 0026.'
           else 'OK - the server can write, clients still cannot.'
         end
  from forced f

  union all
  select 3, '3. WAS ANYTHING WRITTEN',
         e.total || ' events ever, ' || e.recent || ' in the last 2 days',
         case
           when e.total = 0 and p.cases_total = 0
             then 'Nothing to say yet - no case has ever been submitted on this database.'
           when e.total = 0
             then 'STOP - ' || p.cases_total || ' case(s) exist and not one event was ever written. The trigger has never succeeded; see the steps above.'
           when e.recent = 0
             then 'Events exist but none in the last 2 days. Compare against the next line.'
           else 'OK - ' || e.recent || ' celebration(s) recorded recently.'
         end
  from events e cross join pairs p

  union all
  select 4, '4. CASES vs EVENTS',
         p.cases_recent || ' cases in 2 days, ' || p.with_event ||
           ' announced, ' || p.without_event || ' not',
         case
           when p.cases_recent = 0
             then 'No cases submitted in the last 2 days, so there was nothing to announce.'
           when p.without_event > 0
             then 'STOP - ' || p.without_event || ' case(s) saved with no event. The trigger is failing silently. Check the Postgres log for "could not announce".'
           else 'OK - every recent case was announced. The writing side is working, so the problem is DELIVERY - see below.'
         end
  from pairs p

  union all
  select 5, '5. REALTIME',
         case when pb.in_publication > 0 then 'team_events IS published'
              else 'team_events is NOT published' end,
         case
           when pb.in_publication = 0
             then 'STOP - the table is not in the supabase_realtime publication, so nothing is streamed. Run 0028.'
           else 'OK - changes are streamed.'
         end
  from pub pb

  union all
  select 6, '6. CAN THE BROWSER READ IT',
         case when g.can_select > 0 then 'authenticated has SELECT'
              else 'authenticated has NO SELECT' end,
         case
           when g.can_select = 0
             then 'STOP - the browser cannot read the feed, so realtime delivers nothing to it. Re-run 0026.'
           else 'OK.'
         end
  from grants g

  union all
  select 7, '7. NOTE', 'a toast needs the app open',
         'Team celebrations are IN-APP only. They appear if Atlas DART is open in a tab when the case is submitted. If it was closed, nothing is missed permanently - the case should still be listed under the bell. Check there before assuming it failed.'
)

select step, detail, verdict
from report
order by ord;
