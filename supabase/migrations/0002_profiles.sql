-- ---------------------------------------------------------------------------
-- 0002 - profiles
--
-- One row per person, keyed to auth.users. Both roles submit daily (D3), so
-- there is no "does this person submit" flag - active is the only switch.
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  full_name    text        not null check (length(btrim(full_name)) > 0),
  email        text        not null check (length(btrim(email)) > 0),
  role         text        not null default 'consultant'
                 check (role in ('consultant', 'admin')),
  active       boolean     not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists profiles_active_idx on public.profiles (active) where active;
create index if not exists profiles_role_idx on public.profiles (role);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Is the current user an active admin?
--
-- SECURITY DEFINER matters here. This is called from the RLS policies on
-- profiles itself; without it, Postgres would recurse - evaluating the policy
-- that calls the function that reads the table the policy is on. search_path is
-- pinned so a caller cannot redirect the function to a table of their own.
--
-- Defined here rather than in 0001 because a SQL-language function is parsed at
-- creation and cannot reference a table that does not exist yet.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.active
  );
$$;

comment on function public.is_admin is
  'Active-admin check used by RLS. SECURITY DEFINER to avoid recursive policy evaluation on profiles.';

-- ---------------------------------------------------------------------------
-- Column-level protection.
--
-- RLS grants or denies a whole row; it cannot say "you may edit your own name
-- but not your own role". This trigger closes that gap. A consultant updating
-- their own profile is fine; a consultant promoting themselves is not.
--
-- auth.uid() is null on a service-role connection (the scheduled functions),
-- which already bypasses RLS by design, so those are allowed through.
-- ---------------------------------------------------------------------------
create or replace function public.guard_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'Only an admin may change a role'
      using errcode = '42501';
  end if;

  if new.active is distinct from old.active then
    raise exception 'Only an admin may activate or deactivate an account'
      using errcode = '42501';
  end if;

  if new.id is distinct from old.id then
    raise exception 'A profile id cannot be reassigned'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger profiles_guard_columns
  before update on public.profiles
  for each row execute function public.guard_profile_columns();

-- ---------------------------------------------------------------------------
-- Create the profile automatically when an account is created in Supabase Auth,
-- so an admin only ever has to invite a user - never remember a second step.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'role', ''), 'consultant')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

comment on table public.profiles is
  'One row per person. Admins submit their own DART too (decision D3); `active` is the only participation switch.';
