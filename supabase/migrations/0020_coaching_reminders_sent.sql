-- ---------------------------------------------------------------------------
-- 0020 - coaching_reminders_sent
--
-- Idempotency for coaching notifications, keyed by SESSION rather than by day.
--
-- reminder_logs already does this job for the nightly DART chase, keyed on
-- (user_id, business_date, reminder_type). That key cannot be reused here:
-- someone can have two coaching sessions on the same day - a review at 10am
-- and an ad-hoc at 4pm - and the second would collide with the first and be
-- silently skipped.
--
-- Rather than widen a unique constraint the live reminder system depends on,
-- coaching gets its own small table. Forward-only, and nothing that currently
-- works is touched.
-- ---------------------------------------------------------------------------

create table if not exists public.coaching_reminders_sent (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid        not null references public.coaching_sessions (id) on delete cascade,

  -- 'assigned'   - sent the moment an admin books it
  -- 'day_before' - the evening before
  -- 'morning_of' - the morning of the session
  -- 'rescheduled'/'cancelled' - sent when the time moves or it is called off
  kind       text        not null
               check (kind in ('assigned', 'day_before', 'morning_of',
                               'rescheduled', 'cancelled')),

  status     text        not null check (status in ('sent', 'failed')),

  -- A failure must say why, the same rule reminder_logs enforces. A reminder
  -- system that fails silently rots without anyone noticing.
  error_message text,
  sent_at    timestamptz not null default now(),

  constraint coaching_reminder_once unique (session_id, kind),

  constraint coaching_reminder_failure_has_reason check (
    status = 'sent'
    or length(btrim(coalesce(error_message, ''))) > 0
  )
);

create index if not exists coaching_reminders_session_idx
  on public.coaching_reminders_sent (session_id);

alter table public.coaching_reminders_sent enable row level security;
alter table public.coaching_reminders_sent force row level security;

-- Written by the scheduled function on the service-role connection, which
-- bypasses RLS. These policies exist so the app can show whether a reminder
-- went out, not so it can write one.
drop policy if exists coaching_reminders_select on public.coaching_reminders_sent;
create policy coaching_reminders_select on public.coaching_reminders_sent
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.coaching_sessions s
       where s.id = coaching_reminders_sent.session_id
         and s.consultant_id = auth.uid()
    )
  );

grant select on public.coaching_reminders_sent to authenticated;

comment on table public.coaching_reminders_sent is
  'One row per notification per session. Keyed by session, not by day, so two sessions on one day cannot silently collide.';
