-- ---------------------------------------------------------------------------
-- 0007 - cases
--
-- Columns follow the real Consultant_XXX.numbers workbook, which tracks two
-- dates rather than the single "signed date" in the original brief.
--
-- Decision D16: GR credits the month of date_submitted - "as long as submitted,
-- count it as good to go". date_incepted is recorded for visibility (a case with
-- no inception date yet shows up as Pending Inception) but does not gate GR.
--
-- Decision D15: there is no delete path. Cancellation is soft, and 0011_rls.sql
-- deliberately grants no DELETE policy on this table at all, so the rule is
-- enforced by Postgres rather than by the user interface.
-- ---------------------------------------------------------------------------

create table if not exists public.cases (
  id                  uuid primary key default gen_random_uuid(),
  consultant_id       uuid        not null references public.profiles (id) on delete restrict,
  date_submitted      date        not null,
  date_incepted       date,
  client_name         text        not null check (length(btrim(client_name)) > 0),
  insurer_id          uuid        not null references public.insurers (id) on delete restrict,
  policy_name         text        not null check (length(btrim(policy_name)) > 0),
  policy_type         text        not null
                        check (policy_type in ('A&H', 'CIS-Cash', 'CIS-CPF', 'CS',
                                               'GI', 'ILP', 'Term', 'Other')),
  ape_amount          numeric(12, 2) not null default 0 check (ape_amount >= 0),
  gr_amount           numeric(12, 2) not null default 0 check (gr_amount >= 0),
  status              text        not null default 'active'
                        check (status in ('active', 'cancelled')),
  cancellation_reason text,
  cancelled_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- A cancellation is only valid if it carries both a reason and a timestamp,
  -- and an active case must carry neither. This is what makes "cancellation
  -- reason is mandatory" a database guarantee rather than a form validation.
  constraint cases_cancellation_complete check (
    (status = 'active'
      and cancellation_reason is null
      and cancelled_at is null)
    or
    (status = 'cancelled'
      and cancelled_at is not null
      and length(btrim(coalesce(cancellation_reason, ''))) > 0)
  ),

  -- A policy cannot incept before it was submitted.
  constraint cases_inception_not_before_submission check (
    date_incepted is null or date_incepted >= date_submitted
  )
);

-- GR and APE are always aggregated over date_submitted (D16).
create index if not exists cases_consultant_submitted_idx
  on public.cases (consultant_id, date_submitted);

create index if not exists cases_submitted_idx
  on public.cases (date_submitted);

-- Almost every read filters to active cases; keep that index small.
create index if not exists cases_active_idx
  on public.cases (consultant_id, date_submitted)
  where status = 'active';

-- Pending Inception: written business that has not gone live yet.
create index if not exists cases_pending_inception_idx
  on public.cases (consultant_id)
  where status = 'active' and date_incepted is null;

create index if not exists cases_insurer_idx on public.cases (insurer_id);
create index if not exists cases_policy_type_idx on public.cases (policy_type);

create trigger cases_set_updated_at
  before update on public.cases
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Restoring a cancelled case is an admin action (D15). A consultant may cancel
-- their own mistake but may not quietly put it back once management has seen
-- the cancellation.
--
-- This lives in a trigger rather than an RLS policy because a policy only ever
-- sees the row being written - it cannot ask what the status used to be.
-- ---------------------------------------------------------------------------
create or replace function public.guard_case_restore()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- auth.uid() is null on a service-role connection, which already bypasses RLS.
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if old.status = 'cancelled' and new.status = 'active' then
    raise exception 'Only an admin may restore a cancelled case'
      using errcode = '42501';
  end if;

  if old.consultant_id is distinct from new.consultant_id then
    raise exception 'A case cannot be reassigned to another consultant'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger cases_guard_restore
  before update on public.cases
  for each row execute function public.guard_case_restore();

comment on table public.cases is
  'Signed cases. GR credits the month of date_submitted (D16). Never deleted - cancellation is soft (D15).';
comment on column public.cases.date_incepted is
  'Optional. Recorded for visibility only; a null value means Pending Inception and does not affect GR.';
