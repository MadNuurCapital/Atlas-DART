-- ===========================================================================
-- 0034_leave_periods.sql
--
-- Leave & Away Mode: the table, and the two questions everything else asks.
-- ===========================================================================
--
-- An advisor on holiday was still being chased every evening for a DART they
-- had no intention of filling in, marked absent in red on the team board, and
-- told on their return that they had "missed 7 days". This is the record that
-- lets the rest of the system know better.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--
-- It changes no existing object. The table is inert until 0035 wires it in,
-- and nothing in the application writes to it yet. Split this way, the risky
-- half of the feature - altering functions the whole app reads - is one file
-- that can be reverted on its own without dropping anybody's leave record.
--
-- AWAY MODE IS READ-ONLY OVER THE EXISTING MODEL
--
-- Nothing here touches a write path. No trigger fires on daily_submissions or
-- on cases, no policy on either table changes, and no stored figure is
-- recalculated. Away Mode only ever changes the answer to a question asked at
-- read time. That is what makes "Away Mode must never block a legitimate
-- submission" true by construction rather than by testing - a submission
-- cannot be blocked by code that does not exist on its path.
--
-- It is also the lesson of 0029. A celebration trigger on cases took case
-- submission down in production, because an AFTER INSERT trigger that raises
-- rolls back the row that fired it. The way not to repeat that is to not be on
-- the write path at all.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Overlap has to be impossible, not merely checked
-- ---------------------------------------------------------------------------
-- btree_gist lets a GiST index hold the scalar user_id alongside the range,
-- which is what makes a per-person EXCLUDE constraint possible. It ships with
-- Supabase and is free.
--
-- A trigger that SELECTs for a conflicting period and then raises would pass
-- for two concurrent requests - both read, neither sees the other, both
-- insert. A double-tapped "Schedule" button is exactly that race. An exclusion
-- constraint is evaluated by the index itself and cannot be raced.
--
-- 0035 then relies on this: it counts away days by summing clamped range
-- intersections, which is only correct because two periods can never cover the
-- same day twice.

create extension if not exists btree_gist;


-- ---------------------------------------------------------------------------
-- 2. The table
-- ---------------------------------------------------------------------------

create table if not exists public.leave_periods (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid        not null references public.profiles (id) on delete cascade,

  -- Both ends INCLUSIVE, in the Singapore calendar. Leave from the 5th to the
  -- 5th is one day away, not zero.
  starts_on    date        not null,
  ends_on      date        not null,

  reason       text        not null
                 check (reason in ('holiday', 'medical', 'personal', 'other')),

  -- Free text, and required for 'other' - a reason of "Other" with nothing
  -- beside it tells an admin looking at the team board precisely nothing.
  note         text,

  -- Cancelling SOFT-deletes. A deleted row cannot be pointed at by the audit
  -- trail that recorded its cancellation, and "there is no record of it" is
  -- not the same statement as "it was cancelled on the 3rd".
  cancelled_at timestamptz,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint leave_periods_dates_ordered check (ends_on >= starts_on),

  constraint leave_periods_other_needs_a_note check (
    reason <> 'other' or (note is not null and length(btrim(note)) > 0)
  ),

  -- A sanity bound rather than a business rule. Leave is self-declared with no
  -- approval, so the only thing standing between a typo and a year of silence
  -- is this. 180 days is longer than any real absence and short enough that a
  -- mistyped year ("2027-11-05" for "2026-11-05") is refused.
  constraint leave_periods_not_absurdly_long check (ends_on - starts_on <= 180)
);

-- No two live periods for one person may share a day. Partial, so cancelling a
-- period frees its dates immediately - someone who cancels and re-books the
-- same week must not be blocked by the booking they just cancelled.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'leave_periods_no_overlap'
  ) then
    alter table public.leave_periods
      add constraint leave_periods_no_overlap
      exclude using gist (
        user_id with =,
        daterange(starts_on, ends_on, '[]') with &&
      ) where (cancelled_at is null);
  end if;
end;
$$;

-- The hot path: "is this person away on this date", asked by app_bootstrap on
-- every page load and by missing_submissions for all fifteen people five times
-- a night. Cancelled rows are excluded from the index, not just from the query.
create index if not exists leave_periods_live_idx
  on public.leave_periods (user_id, starts_on, ends_on)
  where cancelled_at is null;

-- "Who is away right now", for the admin team view, which reaches across
-- people rather than down one.
create index if not exists leave_periods_window_idx
  on public.leave_periods (starts_on, ends_on)
  where cancelled_at is null;

drop trigger if exists leave_periods_set_updated_at on public.leave_periods;
create trigger leave_periods_set_updated_at
  before update on public.leave_periods
  for each row execute function public.set_updated_at();

comment on table public.leave_periods is
  'Self-declared leave. Both dates inclusive, Singapore calendar. Cancelling sets cancelled_at rather than deleting. No approval workflow by design.';


-- ---------------------------------------------------------------------------
-- 3. Row Level Security
-- ---------------------------------------------------------------------------
-- `force` as well as `enable`, matching every other table in this schema: it
-- binds the table owner too, so a future SECURITY DEFINER function cannot read
-- the whole team by accident.
--
-- Nothing writes here through a SECURITY DEFINER path, so the asymmetry that
-- caused the September outage - FORCE binding a definer trigger that was the
-- table's only legitimate writer - has nothing to bite on.

alter table public.leave_periods enable row level security;
alter table public.leave_periods force  row level security;

-- Own leave always; everybody's if you are an admin. The same shape as
-- submissions_select and cases_select, so there is one rule to understand in
-- this schema rather than four.
--
-- Medical-leave dates are the most sensitive thing in this table, which is why
-- this is not open to the whole team.
drop policy if exists leave_select on public.leave_periods;
create policy leave_select on public.leave_periods
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- You may only ever create your own, and only a coherent range. Backdating IS
-- allowed - somebody hospitalised last week has to be able to put it right -
-- and the audit trail is what makes that accountable rather than silent.
drop policy if exists leave_insert_own on public.leave_periods;
create policy leave_insert_own on public.leave_periods
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and ends_on >= starts_on
    and cancelled_at is null
  );

-- Editing and cancelling: your own, and only while the period has not already
-- finished. A period that ended is history, and history is not editable here.
--
-- The window is on the row AS IT STANDS (using), not on the values being
-- written (with check) - otherwise coming home early would be refused, because
-- shortening a period that is running now means writing an ends_on of
-- yesterday, and that is the single most likely edit anyone will make.
drop policy if exists leave_update_own on public.leave_periods;
create policy leave_update_own on public.leave_periods
  for update to authenticated
  using (user_id = auth.uid() and ends_on >= public.sg_today())
  with check (user_id = auth.uid() and ends_on >= starts_on);

-- No DELETE policy for anyone, admins included. Cancelling is an UPDATE that
-- sets cancelled_at; there is no supported way to make a leave period never
-- have existed, which is the point of having an audit trail at all.

grant select, insert, update on public.leave_periods to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Is this person away on this date?
-- ---------------------------------------------------------------------------
-- The question every suppression in 0035 is built on, in one place so there is
-- one definition of "away" rather than six subqueries that drift apart.
--
-- SECURITY INVOKER, stated rather than left to the default. It therefore sees
-- exactly the rows the caller may see:
--
--   * the reminder functions call it as service_role, which bypasses RLS and
--     so sees everyone - which is what suppressing a push depends on
--   * an admin sees everyone
--   * an advisor sees themselves, and gets `false` for anybody else
--
-- That last case is a deliberate silent false rather than an error. Every
-- read in this schema is shaped by RLS the same way, and the paths where an
-- advisor could ask about someone else return only their own row anyway.

create or replace function public.is_away(p_user uuid, p_date date)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.leave_periods lp
    where lp.user_id      = p_user
      and lp.cancelled_at is null
      and p_date between lp.starts_on and lp.ends_on
  );
$$;

comment on function public.is_away(uuid, date) is
  'Away on this Singapore date? SECURITY INVOKER, so it answers within the caller''s own visibility.';


-- ---------------------------------------------------------------------------
-- 5. How many away days fall inside a window?
-- ---------------------------------------------------------------------------
-- Used by 0035 for two things that are the same arithmetic: the working days a
-- scorecard should ask for, and the days a "you have missed N days" counter
-- should forgive.
--
-- Summing clamped intersections rather than walking a day series. One row per
-- leave period instead of one per day, and it is EXACT rather than approximate
-- only because section 2 makes overlapping periods impossible - two periods
-- covering the same day would count it twice.
--
-- Each term is clamped at zero so an inverted window (p_from after p_to, which
-- monthly_compliance produces for a month that has not started) returns 0
-- rather than a negative number that would quietly inflate required days.

create or replace function public.away_days(p_user uuid, p_from date, p_to date)
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    sum(
      greatest(
        (least(lp.ends_on, p_to) - greatest(lp.starts_on, p_from)) + 1,
        0
      )
    ),
    0
  )::int
  from public.leave_periods lp
  where lp.user_id      = p_user
    and lp.cancelled_at is null
    and lp.starts_on   <= p_to
    and lp.ends_on     >= p_from;
$$;

comment on function public.away_days(uuid, date, date) is
  'Away days within an inclusive window. Exact because leave_periods_no_overlap forbids a day being covered twice.';

revoke all on function public.is_away(uuid, date)          from public, anon;
revoke all on function public.away_days(uuid, date, date)  from public, anon;
grant execute on function public.is_away(uuid, date)         to authenticated;
grant execute on function public.away_days(uuid, date, date) to authenticated;
