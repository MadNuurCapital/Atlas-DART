-- ---------------------------------------------------------------------------
-- Atlas DART - installation health check
--
-- Paste into the Supabase SQL editor and run. Read-only: it inspects and
-- reports, and writes nothing.
--
-- Every row should read PASS. Anything else tells you exactly what to re-run.
--
-- This is the same set of checks as `npm run verify:supabase`, in a form that
-- needs no local tooling.
-- ---------------------------------------------------------------------------

with
tables as (
  select count(*) filter (where relkind = 'r') as n,
         count(*) filter (where relkind = 'r' and relforcerowsecurity) as forced
    from pg_class
   where relnamespace = 'public'::regnamespace
     and relname in ('profiles','consultant_targets','daily_submissions',
                     'appointment_activities','insurers','cases',
                     'reminder_logs','audit_logs')
),
policies as (
  select count(*) as n from pg_policies where schemaname = 'public'
),
views as (
  select count(*) as n,
         count(*) filter (
           where (select option_value from pg_options_to_table(reloptions)
                   where option_name = 'security_invoker') = 'true'
         ) as invoker
    from pg_class
   where relnamespace = 'public'::regnamespace and relkind = 'v'
     and relname like 'v\_%'
),
fns as (
  select count(distinct proname) as n
    from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname in ('is_admin','sg_today','sg_deadline','within_edit_window',
                     'missing_submissions','team_daily','monthly_compliance')
),
signup as (
  select count(*) as n from pg_trigger
   where tgname = 'on_auth_user_created' and not tgisinternal
),
trigs as (
  select count(*) as n
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
),
realtime as (
  select count(*) as n from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public'
     and tablename in ('daily_submissions','appointment_activities','cases')
),
identity as (
  select count(*) filter (where relreplident = 'f') as n
    from pg_class
   where relnamespace = 'public'::regnamespace
     and relname in ('daily_submissions','appointment_activities','cases')
),
wal as (
  select setting from pg_settings where name = 'wal_level'
),
ins as (
  select count(*) as n from public.insurers where active
),
ins_idx as (
  select count(*) as n from pg_indexes
   where schemaname = 'public' and indexname = 'insurers_name_unique'
),
admins as (
  select count(*) as n,
         coalesce(string_agg(full_name, ', '), '') as names
    from public.profiles where role = 'admin' and active
),
people as (
  select count(*) as n from public.profiles where active
)

select * from (
  select 1 as ord,
         case when n = 8 then 'PASS' else 'FAIL' end as status,
         'Tables' as check,
         n || ' of 8 present' as detail,
         case when n = 8 then '' else 'Re-run the whole bundle.' end as fix
    from tables

  union all
  select 2,
         case when forced = 8 then 'PASS' else 'FAIL' end,
         'RLS forced',
         forced || ' of 8 force row level security',
         case when forced = 8 then ''
              else 'Re-run 0011_rls.sql. Plain ENABLE exempts the table owner.' end
    from tables

  union all
  select 3,
         case when n >= 23 then 'PASS' else 'FAIL' end,
         'Policies', n || ' defined (expect 23)',
         case when n >= 23 then '' else 'Re-run 0011_rls.sql.' end
    from policies

  union all
  select 4,
         case when n = 8 then 'PASS' else 'FAIL' end,
         'Views', n || ' of 8 present',
         case when n = 8 then '' else 'Re-run 0010_views.sql.' end
    from views

  union all
  select 5,
         case when n = invoker then 'PASS' else 'FAIL' end,
         'Views are security_invoker',
         invoker || ' of ' || n || ' respect the caller''s RLS',
         case when n = invoker then ''
              else 'RLS BYPASS. Re-run 0010_views.sql immediately - any consultant can read the whole team through those views.' end
    from views

  union all
  select 6,
         case when n = 7 then 'PASS' else 'FAIL' end,
         'Functions', n || ' of 7 present',
         case when n = 7 then '' else 'Re-run 0001, 0002 and 0010.' end
    from fns

  union all
  select 7,
         case when n > 0 then 'PASS' else 'FAIL' end,
         'Signup trigger',
         case when n > 0 then 'profiles are created automatically'
              else 'on_auth_user_created is MISSING' end,
         case when n > 0 then ''
              else 'Re-run 0002_profiles.sql. Without it an invited user signs in with no profile and is signed straight back out.' end
    from signup

  union all
  select 8,
         case when n >= 11 then 'PASS' else 'WARN' end,
         'Business-rule triggers', n || ' on public tables (expect 11)',
         case when n >= 11 then '' else 'Re-run the table migrations 0002-0007.' end
    from trigs

  union all
  select 9,
         case when n = 3 then 'PASS' else 'FAIL' end,
         'Realtime publication', n || ' of 3 tables published',
         case when n = 3 then ''
              else 'Re-run 0013_realtime.sql, or add them under Database > Replication. The admin board will not update live without this.' end
    from realtime

  union all
  select 10,
         case when n = 3 then 'PASS' else 'WARN' end,
         'Replica identity', n || ' of 3 set to FULL',
         case when n = 3 then '' else 'Re-run 0013_realtime.sql.' end
    from identity

  union all
  select 11,
         case when setting = 'logical' then 'PASS' else 'FAIL' end,
         'wal_level', 'wal_level = ' || setting,
         case when setting = 'logical' then ''
              else 'Realtime cannot work at all. Raise with Supabase support.' end
    from wal

  union all
  select 12,
         case when n > 0 then 'PASS' else 'WARN' end,
         'Insurers seeded', n || ' active',
         case when n > 0 then '' else 'Re-run 0012_seed_insurers.sql.' end
    from ins

  union all
  select 13,
         case when n > 0 then 'PASS' else 'FAIL' end,
         'Insurer de-duplication',
         case when n > 0 then 'the same insurer cannot exist twice'
              else 'unique index MISSING' end,
         case when n > 0 then '' else 'Re-run 0006_insurers.sql.' end
    from ins_idx

  union all
  select 14,
         case when n > 0 then 'PASS' else 'FAIL' end,
         'Admin accounts',
         case when n > 0 then n || ': ' || names else 'none yet' end,
         case when n > 0 then ''
              else 'Create a user under Authentication > Users, then: update public.profiles set role = ''admin'' where email = ''...'';' end
    from admins

  union all
  select 15, 'INFO', 'People', n || ' active', '' from people

  union all
  select 16, 'INFO', 'Singapore date',
         public.sg_today()::text || ', deadline ' ||
         to_char(public.sg_deadline(public.sg_today()) at time zone 'Asia/Singapore', 'HH24:MI:SS'),
         ''
) checks
order by ord;
