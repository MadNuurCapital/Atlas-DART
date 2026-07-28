-- ---------------------------------------------------------------------------
-- 0003 - consultant_targets
--
-- Decision D4: targets are effective-dated rather than a single column on
-- profiles. Raising someone's target in June must not retroactively rewrite
-- May's shortfall, which is exactly what a scalar column would do.
--
-- Decision D17: the yearly row is the number actually maintained. A monthly
-- row is an optional override; without one, the monthly target is yearly / 12.
-- ---------------------------------------------------------------------------

create table if not exists public.consultant_targets (
  id            uuid primary key default gen_random_uuid(),
  consultant_id uuid        not null references public.profiles (id) on delete cascade,
  period_type   text        not null check (period_type in ('monthly', 'yearly')),
  year          integer     not null check (year between 2000 and 2200),
  month         integer     check (month between 1 and 12),
  gr_target     numeric(12, 2) not null check (gr_target >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint targets_month_matches_period check (
    (period_type = 'yearly'  and month is null) or
    (period_type = 'monthly' and month is not null)
  )
);

-- coalesce(month, 0) so the yearly rows collide correctly - a plain unique
-- constraint over a nullable column would allow unlimited duplicate yearly rows.
create unique index if not exists consultant_targets_unique
  on public.consultant_targets (consultant_id, period_type, year, coalesce(month, 0));

create index if not exists consultant_targets_lookup_idx
  on public.consultant_targets (consultant_id, year);

create trigger consultant_targets_set_updated_at
  before update on public.consultant_targets
  for each row execute function public.set_updated_at();

comment on table public.consultant_targets is
  'Effective-dated GR targets. Yearly row is authoritative; monthly rows are optional overrides (D17).';
