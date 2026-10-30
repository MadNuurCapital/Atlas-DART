-- ===========================================================================
-- 0028_team_events_realtime.sql
--
-- Put the team feed on the wire, so a celebration arrives without a refresh.
-- ===========================================================================
--
-- Supabase streams a table's changes only if it is a member of the
-- supabase_realtime publication. 0013 did this for daily_submissions,
-- appointment_activities and cases; this adds team_events.
--
-- Guarded the same way as 0013, so re-applying the file is a no-op rather
-- than an error.
--
-- REPLICA IDENTITY is deliberately left at the default (primary key only),
-- unlike the three tables in 0013 which are set to FULL.
--
-- FULL makes Postgres write every column of the OLD row into the WAL, which
-- those tables need because the admin board listens for UPDATE and DELETE and
-- wants to know what changed. team_events is append-only: there is no update
-- policy and no delete policy for anyone, and the client subscribes to INSERT
-- alone, where the new row is sent in full regardless. Setting FULL here would
-- add WAL volume for information nothing reads.
--
-- RLS still applies to what is streamed, so a client receives only rows its
-- own policies would have let it SELECT. team_events is readable by every
-- signed-in colleague, which is the entire point of it.
-- ===========================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'team_events'
  ) then
    alter publication supabase_realtime add table public.team_events;
  end if;
end
$$;
