-- ---------------------------------------------------------------------------
-- 0013 - Realtime publication.
--
-- The admin daily board subscribes to these three tables so a submission
-- appears without anyone refreshing the page. A table only emits change events
-- if it is a member of the supabase_realtime publication.
--
-- Row Level Security still applies to Realtime: a subscriber receives an event
-- only for rows their policies would let them SELECT. A consultant listening on
-- daily_submissions therefore hears about their own rows and nobody else's.
--
-- REPLICA IDENTITY FULL makes the OLD row available on updates and deletes.
-- Without it Postgres sends only the primary key, so a subscriber cannot tell
-- what actually changed - and an admin board that cannot distinguish "a case
-- was cancelled" from "some case row changed" has to refetch on every event.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    -- Supabase creates this publication for us; a bare Postgres used by the
    -- test harness does not have it.
    create publication supabase_realtime;
  end if;
end
$$;

alter table public.daily_submissions      replica identity full;
alter table public.appointment_activities replica identity full;
alter table public.cases                  replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'daily_submissions'
  ) then
    alter publication supabase_realtime add table public.daily_submissions;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'appointment_activities'
  ) then
    alter publication supabase_realtime add table public.appointment_activities;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'cases'
  ) then
    alter publication supabase_realtime add table public.cases;
  end if;
end
$$;
