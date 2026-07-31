-- ---------------------------------------------------------------------------
-- 0018 - coaching_sessions
--
-- Private one-to-one coaching. An admin books a session for one person; only
-- that person sees it. A consultant may also ask for coaching, which arrives
-- as a row with status 'requested' and no time on it yet, for an admin to
-- schedule or decline.
--
-- Two things here are load-bearing and easy to get wrong:
--
--   1. A consultant must never see anyone else's coaching, and must never see
--      their own completed or missed history - decided during discovery. That
--      is a policy in 0018's RLS section below, not a WHERE clause in a page,
--      because a page can be bypassed and a policy cannot.
--
--   2. Internal and outcome notes must never reach the person being coached.
--      RLS grants or denies whole ROWS, so those columns cannot live here -
--      a consultant allowed to read their own row could read every column of
--      it. They live in coaching_notes (0019), which no consultant can read at
--      all.
--
-- Like cases, there is no delete path: cancelling is soft and the row survives.
-- ---------------------------------------------------------------------------

create table if not exists public.coaching_sessions (
  id                  uuid primary key default gen_random_uuid(),

  -- The person being coached. Anyone active, admins included.
  consultant_id       uuid        not null references public.profiles (id) on delete cascade,

  -- Who is running it. Null on a request that has not been scheduled yet, and
  -- set null rather than cascade if that admin's account is ever removed - the
  -- session still happened.
  coach_id            uuid        references public.profiles (id) on delete set null,

  -- Who created the row. The consultant themselves on a request.
  created_by          uuid        not null references public.profiles (id) on delete restrict,

  title               text        not null check (length(btrim(title)) > 0),
  category            text        not null
                        check (category in ('monthly_review', 'mid_year_review',
                                            'yearly_review', 'ad_hoc')),

  -- Short line shown on the card, e.g. "Please be reminded that you have an
  -- upcoming coaching session."
  message             text,

  -- All coaching is in person; the admin says where to meet.
  location            text,

  -- Two agendas on purpose. The consultant says what they want coached on when
  -- requesting; the admin writes what the session will cover. Keeping them
  -- apart means scheduling something different does not erase what was asked.
  requested_topic     text,
  agenda              text,

  -- Null until scheduled. Stored as timestamptz and displayed in Singapore.
  scheduled_at        timestamptz,

  status              text        not null default 'scheduled'
                        check (status in ('requested', 'scheduled', 'completed',
                                          'cancelled', 'declined', 'missed')),

  acknowledged_at     timestamptz,
  completed_at        timestamptz,
  cancelled_at        timestamptz,
  cancellation_reason text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- A session that is on, or has been, must know when it was.
  constraint coaching_scheduled_has_time check (
    status in ('requested', 'cancelled', 'declined')
    or scheduled_at is not null
  ),

  -- Cancelling and declining both require a reason, the same way cancelling a
  -- case does. A refusal with no explanation is worse than no record at all.
  constraint coaching_cancellation_complete check (
    (status not in ('cancelled', 'declined')
      and cancellation_reason is null
      and cancelled_at is null)
    or
    (status in ('cancelled', 'declined')
      and cancelled_at is not null
      and length(btrim(coalesce(cancellation_reason, ''))) > 0)
  ),

  constraint coaching_completed_has_time check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  ),

  -- Only a scheduled session can be acknowledged. Acknowledging a request or a
  -- cancelled session is meaningless.
  constraint coaching_acknowledged_only_when_scheduled check (
    acknowledged_at is null or status = 'scheduled'
  )
);

-- What the dashboard asks for: this person's next session.
create index if not exists coaching_consultant_time_idx
  on public.coaching_sessions (consultant_id, scheduled_at);

-- Upcoming is by far the most common read; keep that index small.
create index if not exists coaching_upcoming_idx
  on public.coaching_sessions (consultant_id, scheduled_at)
  where status = 'scheduled';

-- The admin queue: requests waiting to be scheduled or declined.
create index if not exists coaching_requested_idx
  on public.coaching_sessions (created_at)
  where status = 'requested';

create index if not exists coaching_coach_idx on public.coaching_sessions (coach_id);
create index if not exists coaching_status_idx on public.coaching_sessions (status);

drop trigger if exists coaching_sessions_set_updated_at on public.coaching_sessions;
create trigger coaching_sessions_set_updated_at
  before update on public.coaching_sessions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Rescheduling clears the acknowledgement.
--
-- Someone who confirmed a Friday 2pm has confirmed a meeting that no longer
-- exists. Leaving the tick in place would tell an admin they had seen a change
-- they have never been shown.
--
-- Owned by the database rather than the server action so it holds however the
-- row is updated.
-- ---------------------------------------------------------------------------
create or replace function public.handle_coaching_reschedule()
returns trigger
language plpgsql
as $$
begin
  if new.scheduled_at is distinct from old.scheduled_at then
    new.acknowledged_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists coaching_reschedule on public.coaching_sessions;
create trigger coaching_reschedule
  before update on public.coaching_sessions
  for each row execute function public.handle_coaching_reschedule();

-- ---------------------------------------------------------------------------
-- A consultant may acknowledge, and nothing else.
--
-- RLS decides whether a row may be written at all; it cannot say "you may tick
-- this box but not move the date". Same gap the profiles role guard closes,
-- and the same solution.
-- ---------------------------------------------------------------------------
create or replace function public.guard_coaching_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- auth.uid() is null on a service-role connection (the scheduled reminder
  -- function), which already bypasses RLS by design.
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if (new.consultant_id, new.coach_id, new.created_by, new.title, new.category,
      new.message, new.location, new.requested_topic, new.agenda,
      new.scheduled_at, new.status, new.completed_at, new.cancelled_at,
      new.cancellation_reason)
     is distinct from
     (old.consultant_id, old.coach_id, old.created_by, old.title, old.category,
      old.message, old.location, old.requested_topic, old.agenda,
      old.scheduled_at, old.status, old.completed_at, old.cancelled_at,
      old.cancellation_reason)
  then
    raise exception 'Only an admin may change a coaching session'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists coaching_guard_columns on public.coaching_sessions;
create trigger coaching_guard_columns
  before update on public.coaching_sessions
  for each row execute function public.guard_coaching_columns();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.coaching_sessions enable row level security;
alter table public.coaching_sessions force row level security;

-- A consultant sees their own upcoming coaching and their own pending request,
-- and nothing else. Completed and missed sessions are deliberately unreachable
-- - coaching history belongs to management. A cancelled or declined session
-- stays visible for a week so nobody is left waiting for a meeting that is not
-- happening, then disappears.
drop policy if exists coaching_select on public.coaching_sessions;
create policy coaching_select on public.coaching_sessions
  for select to authenticated
  using (
    public.is_admin()
    or (
      consultant_id = auth.uid()
      and (
        status in ('requested', 'scheduled')
        or (
          status in ('cancelled', 'declined')
          and cancelled_at > now() - interval '7 days'
        )
      )
    )
  );

-- An admin books for anyone. A consultant may only ask, only for themselves,
-- and only without a time - scheduling is not theirs to do.
drop policy if exists coaching_insert on public.coaching_sessions;
create policy coaching_insert on public.coaching_sessions
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      consultant_id = auth.uid()
      and created_by = auth.uid()
      and status = 'requested'
      and scheduled_at is null
      and coach_id is null
    )
  );

-- The column guard above is what limits a consultant to acknowledging.
drop policy if exists coaching_update on public.coaching_sessions;
create policy coaching_update on public.coaching_sessions
  for update to authenticated
  using (public.is_admin() or consultant_id = auth.uid())
  with check (public.is_admin() or consultant_id = auth.uid());

-- No DELETE policy, deliberately. Cancelling is soft and the record survives.

grant select, insert, update on public.coaching_sessions to authenticated;

comment on table public.coaching_sessions is
  'Private one-to-one coaching. A consultant sees only their own upcoming sessions and requests - never history, never anyone else. Never deleted.';

-- ---------------------------------------------------------------------------
-- Realtime, so an admin watching the list sees a request arrive.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'coaching_sessions'
     )
  then
    alter publication supabase_realtime add table public.coaching_sessions;
  end if;
end
$$;
