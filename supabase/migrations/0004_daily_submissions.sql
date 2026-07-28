-- ---------------------------------------------------------------------------
-- 0004 - daily_submissions
--
-- One row per person per Singapore business date. The unique constraint is the
-- real guarantee; the application upserts onto it rather than checking first,
-- which is what makes a double-click or a network retry harmless.
-- ---------------------------------------------------------------------------

create table if not exists public.daily_submissions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid        not null references public.profiles (id) on delete cascade,
  business_date      date        not null,
  dials              integer     not null default 0 check (dials >= 0),
  talked_to          integer     not null default 0 check (talked_to >= 0),
  campaign_status    text        not null
                       check (campaign_status in ('running', 'paused', 'not_running')),
  in_office          boolean     not null,
  notes              text,
  status             text        not null default 'draft'
                       check (status in ('draft', 'submitted')),
  first_submitted_at timestamptz,
  last_submitted_at  timestamptz,
  revision_count     integer     not null default 0 check (revision_count >= 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint daily_submissions_user_date_unique unique (user_id, business_date),

  -- "Not in the future" cannot live in a CHECK constraint - Postgres requires
  -- those to be immutable and now() is not. It is enforced by the RLS write
  -- policy via within_edit_window(), which already caps at today.

  -- A submitted record must carry its timestamps; a draft must not.
  constraint daily_submissions_timing_coherent check (
    (status = 'draft')
    or (status = 'submitted' and first_submitted_at is not null and last_submitted_at is not null)
  )
);

create index if not exists daily_submissions_business_date_idx
  on public.daily_submissions (business_date);

create index if not exists daily_submissions_user_date_idx
  on public.daily_submissions (user_id, business_date desc);

create index if not exists daily_submissions_submitted_idx
  on public.daily_submissions (business_date)
  where status = 'submitted';

drop trigger if exists daily_submissions_set_updated_at on public.daily_submissions;
create trigger daily_submissions_set_updated_at
  before update on public.daily_submissions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Submission timing is owned by the database, never by the client.
--
-- Three rules the application must not be able to break:
--
--   1. first_submitted_at is written once and never moves. On-time status is
--      derived from it, so a client that could rewrite it could claim to have
--      submitted before a deadline it missed.
--   2. revision_count increases only when an ALREADY-submitted record is
--      changed and submitted again. Resubmitting identical values - which is
--      what a double-click or a retried request looks like - changes nothing.
--   3. last_submitted_at moves on every real resubmission.
-- ---------------------------------------------------------------------------
create or replace function public.handle_submission_timing()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'submitted' then
      new.first_submitted_at := now();
      new.last_submitted_at  := now();
    else
      new.first_submitted_at := null;
      new.last_submitted_at  := null;
    end if;
    new.revision_count := 0;
    return new;
  end if;

  -- UPDATE. Start by discarding whatever the client sent for these three
  -- columns: they are ours, not theirs.
  new.first_submitted_at := old.first_submitted_at;
  new.last_submitted_at  := old.last_submitted_at;
  new.revision_count     := old.revision_count;

  if new.status = 'submitted' then
    if old.first_submitted_at is null then
      -- Draft becoming submitted, or a first submission. Not a revision.
      new.first_submitted_at := now();
      new.last_submitted_at  := now();
    elsif old.status = 'submitted' then
      -- Already submitted. Only count it as a revision if the figures that
      -- management actually reads have changed. An identical resubmit is a
      -- double click, and must not inflate the revision count or the time.
      if (new.dials, new.talked_to, new.campaign_status, new.in_office,
          coalesce(new.notes, ''))
         is distinct from
         (old.dials, old.talked_to, old.campaign_status, old.in_office,
          coalesce(old.notes, ''))
      then
        new.last_submitted_at := now();
        new.revision_count    := old.revision_count + 1;
      end if;
    else
      -- Was submitted before, went back to draft, now submitted again.
      new.last_submitted_at := now();
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists daily_submissions_timing on public.daily_submissions;
create trigger daily_submissions_timing
  before insert or update on public.daily_submissions
  for each row execute function public.handle_submission_timing();

comment on column public.daily_submissions.first_submitted_at is
  'Write-once, trigger-owned. On-time status derives from this, so the client must never be able to set it.';
comment on column public.daily_submissions.revision_count is
  'Trigger-owned. Increments only when an already-submitted record changes materially - never on an identical resubmit.';
