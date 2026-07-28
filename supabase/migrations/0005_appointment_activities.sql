-- ---------------------------------------------------------------------------
-- 0005 - appointment_activities
--
-- One row per prospect appointment. AO / AC / FU / N are always COUNTED from
-- these rows and never typed by a consultant, so the totals cannot disagree
-- with the detail behind them.
-- ---------------------------------------------------------------------------

create table if not exists public.appointment_activities (
  id                  uuid primary key default gen_random_uuid(),
  daily_submission_id uuid        not null references public.daily_submissions (id) on delete cascade,
  user_id             uuid        not null references public.profiles (id) on delete cascade,
  business_date       date        not null,
  prospect_name       text        not null check (length(btrim(prospect_name)) > 0),
  appointment_type    text        not null
                        check (appointment_type in ('opening', 'closing', 'follow_up', 'nomination')),
  note                text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists appointment_activities_user_date_idx
  on public.appointment_activities (user_id, business_date);

create index if not exists appointment_activities_submission_idx
  on public.appointment_activities (daily_submission_id);

create index if not exists appointment_activities_type_idx
  on public.appointment_activities (business_date, appointment_type);

drop trigger if exists appointment_activities_set_updated_at on public.appointment_activities;
create trigger appointment_activities_set_updated_at
  before update on public.appointment_activities
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- An appointment's owner and date are DERIVED from its parent submission, not
-- accepted from the caller. Combined with the RLS insert policy (which requires
-- user_id = auth.uid()), attaching an appointment to someone else's submission
-- fails: the trigger rewrites user_id to the real owner, and the RLS WITH CHECK
-- then rejects the row.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_appointment_parent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent record;
begin
  select ds.user_id, ds.business_date
    into parent
    from public.daily_submissions ds
   where ds.id = new.daily_submission_id;

  if not found then
    raise exception 'Appointment references a daily submission that does not exist'
      using errcode = '23503';
  end if;

  new.user_id       := parent.user_id;
  new.business_date := parent.business_date;

  return new;
end;
$$;

drop trigger if exists appointment_activities_enforce_parent on public.appointment_activities;
create trigger appointment_activities_enforce_parent
  before insert or update on public.appointment_activities
  for each row execute function public.enforce_appointment_parent();

comment on table public.appointment_activities is
  'Prospect-level appointments. AO/AC/FU/N are counted from here - never entered as totals.';
