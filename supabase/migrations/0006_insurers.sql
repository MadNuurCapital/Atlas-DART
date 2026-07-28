-- ---------------------------------------------------------------------------
-- 0006 - insurers
--
-- Decision D19: consultants add insurers themselves, so this is a table rather
-- than a CHECK constraint - insurers get renamed (AXA became HSBC Life, Aviva
-- became Singlife) and a rename should not require a migration.
--
-- The unique index on lower(btrim(name)) is the safeguard that keeps reporting
-- intact: without it you end up with "AIA", "AIA Singapore" and "aia " as three
-- different insurers and the category totals quietly fragment.
-- ---------------------------------------------------------------------------

create table if not exists public.insurers (
  id         uuid primary key default gen_random_uuid(),
  name       text        not null check (length(btrim(name)) > 0),
  active     boolean     not null default true,
  created_by uuid        references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists insurers_name_unique
  on public.insurers (lower(btrim(name)));

create index if not exists insurers_active_idx
  on public.insurers (active) where active;

drop trigger if exists insurers_set_updated_at on public.insurers;
create trigger insurers_set_updated_at
  before update on public.insurers
  for each row execute function public.set_updated_at();

-- Normalise on the way in so " aia  singapore " and "AIA Singapore" collide on
-- the unique index rather than both being stored.
create or replace function public.normalise_insurer_name()
returns trigger
language plpgsql
as $$
begin
  new.name := btrim(regexp_replace(new.name, '\s+', ' ', 'g'));
  return new;
end;
$$;

drop trigger if exists insurers_normalise_name on public.insurers;
create trigger insurers_normalise_name
  before insert or update on public.insurers
  for each row execute function public.normalise_insurer_name();

comment on table public.insurers is
  'Consultant-extendable insurer list (D19). Unique on lower(name) so the same insurer cannot exist twice.';
