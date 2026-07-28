-- ---------------------------------------------------------------------------
-- Supabase compatibility shim for the local RLS test harness (owner half).
--
-- Supabase provides an `auth` schema, an `auth.users` table, an `auth.uid()`
-- function that reads the verified JWT, and the `anon` / `authenticated` /
-- `service_role` database roles. A stock PostgreSQL install has none of these,
-- so the migrations would not even parse against it.
--
-- This file recreates exactly those pieces - no more - so the real migrations
-- apply unmodified and the real policies are exercised against real Postgres.
-- Tests impersonate a user with:
--
--     set local role authenticated;
--     select set_config('request.jwt.claim.sub', '<uuid>', true);
--
-- which is the same mechanism Supabase uses in production.
--
-- Roles and pgcrypto come from shim-bootstrap.sql, which needs superuser.
-- This file is NEVER applied to a Supabase project.
-- ---------------------------------------------------------------------------

create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  raw_user_meta_data jsonb       not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- Mirrors Supabase's auth.uid(): the subject of the verified JWT, or NULL when
-- there is no user session - which is what a service-role connection looks like.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$;

grant usage on schema auth to authenticated, anon, service_role;
grant select on auth.users to authenticated, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;
grant execute on function auth.role() to authenticated, anon, service_role;
