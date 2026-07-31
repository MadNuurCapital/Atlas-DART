-- ---------------------------------------------------------------------------
-- 0019 - coaching_notes
--
-- Why this is a separate table rather than two more columns on
-- coaching_sessions.
--
-- Row Level Security grants or denies whole ROWS. A consultant who is allowed
-- to read their own coaching session is allowed to read every column of it -
-- there is no policy that says "this row, but not those two fields". Column
-- privileges cannot help either: both roles connect to Postgres as the same
-- `authenticated` role, so revoking a column from a consultant would revoke it
-- from an admin too.
--
-- So the honest way to make a note unreadable by the person it is about is to
-- put it in a table they have no policy on at all. A consultant querying this
-- table directly - through the API, with their own token - gets zero rows.
-- Not a filtered column. No rows.
--
-- One row per session, keyed by the session itself.
-- ---------------------------------------------------------------------------

create table if not exists public.coaching_notes (
  session_id     uuid primary key
                   references public.coaching_sessions (id) on delete cascade,

  -- What management wants to raise, before the session.
  internal_notes text,

  -- What came out of it, after.
  outcome_notes  text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists coaching_notes_set_updated_at on public.coaching_notes;
create trigger coaching_notes_set_updated_at
  before update on public.coaching_notes
  for each row execute function public.set_updated_at();

alter table public.coaching_notes enable row level security;
alter table public.coaching_notes force row level security;

-- Every policy on this table requires is_admin(). There is deliberately no
-- "own rows" clause anywhere: being the subject of a note is not grounds for
-- reading it.
drop policy if exists coaching_notes_select on public.coaching_notes;
create policy coaching_notes_select on public.coaching_notes
  for select to authenticated
  using (public.is_admin());

drop policy if exists coaching_notes_insert on public.coaching_notes;
create policy coaching_notes_insert on public.coaching_notes
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists coaching_notes_update on public.coaching_notes;
create policy coaching_notes_update on public.coaching_notes
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- No DELETE policy. Notes go when the session does, by cascade, and not before.

grant select, insert, update on public.coaching_notes to authenticated;

comment on table public.coaching_notes is
  'Admin-only coaching notes. Separate from coaching_sessions because RLS cannot hide columns - a consultant has no policy here, so a direct query returns nothing.';
