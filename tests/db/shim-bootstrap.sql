-- ---------------------------------------------------------------------------
-- Superuser half of the Supabase compatibility shim.
--
-- Creates only the things a stock PostgreSQL install will not let an ordinary
-- role create: the platform roles, and the pgcrypto extension. Everything else
-- lives in shim.sql and is created by the test user so it owns those objects
-- (migration 0002 puts a trigger on auth.users, which requires ownership).
--
-- Run against the test database as the cluster superuser. Never run against a
-- real Supabase project.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;
