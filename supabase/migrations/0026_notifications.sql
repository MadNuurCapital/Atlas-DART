-- ===========================================================================
-- 0026_notifications.sql
--
-- The notification centre, and the team feed behind the celebrations.
-- ===========================================================================
--
-- Two tables, because they answer two different questions and have two
-- different audiences.
--
--   notifications  one row per PERSON. "Your streak reached 5 days." Only the
--                  person it is addressed to can read it.
--
--   team_events    one row for EVERYONE. "Zul just submitted a case." Every
--                  signed-in colleague reads the same row.
--
-- Keeping them apart is what lets the team feed exist without loosening a
-- single policy on `cases`. Nobody gains read access to anybody's business;
-- a separate, deliberately thin record is written alongside it.
--
--
-- WHAT A TEAM EVENT MAY CONTAIN
--
-- The agreed shape is "named, no product and no amount": the team learns that
-- Zul submitted a case, not that it was an ILP worth S$4,200.
--
-- That decision is enforced by the SHAPE of this table rather than by the
-- discipline of whoever writes to it. There is no policy_type column and no
-- amount column, so no future trigger, backfill or well-meaning change can
-- start leaking either without an obvious schema migration that someone has to
-- justify. A privacy rule that lives only in a convention is one bad afternoon
-- from being broken.
--
--
-- WHY actor_name IS DENORMALISED
--
-- Row Level Security on `profiles` is (id = auth.uid() OR is_admin()), so a
-- consultant can read exactly one profile row: their own. A feed that stored
-- only actor_id and joined for the name would render "null just submitted a
-- case" for all fourteen colleagues - which is precisely the bug found in the
-- coaching card during the performance work, where a consultant could not see
-- their own coach's name for exactly this reason.
--
-- So the name is copied onto the event at write time, by a SECURITY DEFINER
-- trigger that may read profiles. A later rename does not rewrite history,
-- which is correct: the feed says who submitted it at the time.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- The shared team feed
-- ---------------------------------------------------------------------------

create table if not exists public.team_events (
  id         uuid primary key default gen_random_uuid(),

  kind       text not null
               check (kind in ('case_submitted')),

  -- Who did the thing, and what they were called when they did it.
  actor_id   uuid not null references public.profiles (id) on delete cascade,
  actor_name text not null,

  -- The case this celebrates. UNIQUE, which is the whole duplicate guard: a
  -- retried insert, a double-clicked form or a replayed trigger lands on the
  -- same row instead of buzzing fifteen people twice.
  --
  -- Nullable because later event kinds need not be about a case, and Postgres
  -- permits many NULLs in a unique column.
  case_id    uuid unique references public.cases (id) on delete cascade,

  created_at timestamptz not null default now()
);

create index if not exists team_events_created_at_idx
  on public.team_events (created_at desc);

alter table public.team_events enable row level security;
alter table public.team_events force row level security;

-- Everyone signed in reads the feed. That is the point of it.
--
-- Deactivating a leaver is enforced at sign-in rather than here: a policy that
-- re-reads `profiles` would be a second recursive lookup on every row of a
-- feed, and `is_admin()` exists as SECURITY DEFINER precisely because that
-- pattern is a trap.
drop policy if exists team_events_select_all on public.team_events;
create policy team_events_select_all on public.team_events
  for select to authenticated
  using (auth.uid() is not null);

-- No insert, update or delete policy exists, for anybody, deliberately.
--
-- The only writer is the SECURITY DEFINER trigger below, which fires on a real
-- INSERT into `cases`. A client cannot post a celebration for a case that was
-- never written, and cannot delete one that was.


-- ---------------------------------------------------------------------------
-- The personal notification centre
-- ---------------------------------------------------------------------------

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),

  user_id    uuid not null references public.profiles (id) on delete cascade,

  kind       text not null,
  title      text not null,
  body       text,

  -- Where tapping it should go. Relative, so it survives a domain change -
  -- which has already happened once on this project and orphaned every push
  -- subscription.
  url        text,

  -- A de-duplication handle, unique PER PERSON: 'streak_5_2026-03-02'. Two
  -- attempts to award the same thing collide instead of stacking.
  dedupe_key text not null,

  read_at    timestamptz,
  created_at timestamptz not null default now(),

  unique (user_id, dedupe_key)
);

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;
alter table public.notifications force row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

-- Marking something read is the only thing a person may change about it. The
-- WITH CHECK repeats the USING clause so a row cannot be updated INTO
-- somebody else's name.
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No insert policy. Notifications are written by the server, never claimed by
-- a client - otherwise anyone could award themselves a milestone.
-- No delete policy. Read is a state, not a deletion.


-- ---------------------------------------------------------------------------
-- The trigger that turns a real case into a celebration
-- ---------------------------------------------------------------------------
--
-- On INSERT only. Editing a case is bookkeeping; the team does not want to
-- hear about a corrected client name, and the congratulations dialog the
-- advisor sees already makes that distinction.
--
-- SECURITY DEFINER for two reasons: it reads `profiles` to copy the actor's
-- name, which the inserting consultant may not do, and it writes to a table
-- that has no insert policy for anyone at all.

create or replace function public.on_case_created()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- A case created already-cancelled is not a thing to celebrate. This is
  -- defensive: the application has no path that does it.
  if new.status is distinct from 'active' then
    return new;
  end if;

  insert into public.team_events (kind, actor_id, actor_name, case_id)
  select 'case_submitted', new.consultant_id, p.full_name, new.id
  from public.profiles p
  where p.id = new.consultant_id
  on conflict (case_id) do nothing;

  return new;
end;
$$;

drop trigger if exists cases_announce_to_team on public.cases;

create trigger cases_announce_to_team
  after insert on public.cases
  for each row
  execute function public.on_case_created();

comment on table public.team_events is
  'Shared feed of things worth celebrating. Deliberately holds no product type and no amount: the shape of the table is the privacy rule.';

comment on table public.notifications is
  'Per-person notification centre. Written by the server only; a person may mark their own read and nothing else.';


-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
--
-- RLS filters rows; grants decide whether the role may attempt the verb at
-- all. Both gates are set as tightly as the feature allows, so that a mistake
-- in one is still caught by the other.
--
-- team_events gets SELECT and nothing else. Not because the policies would
-- permit more - there is no insert, update or delete policy for anyone - but
-- because a client should be refused before RLS is even consulted.
grant select on public.team_events to authenticated;

-- notifications gets SELECT and UPDATE. UPDATE is needed to mark something
-- read, and the policy confines that to the caller's own rows. No INSERT:
-- nobody awards themselves a milestone. No DELETE: read is a state, not a
-- deletion, and a notification someone did not like is not theirs to destroy.
grant select, update on public.notifications to authenticated;
