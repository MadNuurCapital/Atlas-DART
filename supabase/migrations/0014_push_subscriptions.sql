-- ---------------------------------------------------------------------------
-- 0014 - push_subscriptions
--
-- One row per browser a person has enabled notifications on. Somebody with a
-- phone and a laptop legitimately has two, and both should be pinged.
--
-- The endpoint is the browser's push service URL. It is unique per
-- installation and is the natural key: re-subscribing on the same device
-- returns the same endpoint, so an upsert on it keeps the table from growing
-- a duplicate every time the app is opened.
-- ---------------------------------------------------------------------------

create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid        not null references public.profiles (id) on delete cascade,
  endpoint      text        not null,
  p256dh        text        not null,
  auth          text        not null,
  user_agent    text,
  -- Consecutive send failures. A browser that has been uninstalled returns
  -- 404 or 410 forever; after a few we stop trying rather than burning a
  -- request per person per hour on a dead endpoint.
  failure_count integer     not null default 0 check (failure_count >= 0),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,

  constraint push_subscriptions_endpoint_unique unique (endpoint)
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

-- The sender only ever wants live endpoints.
create index if not exists push_subscriptions_live_idx
  on public.push_subscriptions (user_id)
  where failure_count < 5;

alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force row level security;

drop policy if exists push_select_own on public.push_subscriptions;
create policy push_select_own on public.push_subscriptions
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists push_insert_own on public.push_subscriptions;
create policy push_insert_own on public.push_subscriptions
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists push_update_own on public.push_subscriptions;
create policy push_update_own on public.push_subscriptions
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Turning notifications off must genuinely remove the subscription, otherwise
-- the phone keeps buzzing after someone has asked it to stop.
drop policy if exists push_delete_own on public.push_subscriptions;
create policy push_delete_own on public.push_subscriptions
  for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

grant select, insert, update, delete on public.push_subscriptions to authenticated;

comment on table public.push_subscriptions is
  'One row per browser with notifications enabled. Unique on endpoint so re-subscribing updates rather than duplicates.';
