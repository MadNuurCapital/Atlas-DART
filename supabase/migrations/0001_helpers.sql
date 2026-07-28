-- ---------------------------------------------------------------------------
-- 0001 - Shared helper functions.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;

-- Keeps updated_at honest without the application having to remember.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Today's business date in Singapore. Every date decision in the application
-- routes through this, so "today" means the same thing in Postgres, in the
-- scheduled functions, and in the browser.
create or replace function public.sg_today()
returns date
language sql
stable
as $$
  select (now() at time zone 'Asia/Singapore')::date;
$$;

-- The 23:59:59.999 Singapore deadline for a business date, as a timestamptz.
create or replace function public.sg_deadline(p_date date)
returns timestamptz
language sql
immutable
as $$
  select ((p_date + time '23:59:59.999') at time zone 'Asia/Singapore');
$$;

-- public.is_admin() is defined in 0002, immediately after the profiles table.
-- A SQL-language function is parsed when it is created, so it cannot reference
-- a table that does not exist yet. It stays SQL rather than plpgsql on purpose:
-- RLS calls it once per row, and a SQL function can be inlined by the planner.

-- How many days back a consultant may still write their own records (D2).
create or replace function public.edit_window_days()
returns integer
language sql
immutable
as $$
  select 7;
$$;

-- Is this business date still writable by its owner? Future dates never are.
create or replace function public.within_edit_window(p_date date)
returns boolean
language sql
stable
as $$
  select p_date <= public.sg_today()
     and p_date >= public.sg_today() - public.edit_window_days();
$$;

comment on function public.within_edit_window is
  'Decision D2: consultants may write their own records for the last 7 Singapore days only. Admins bypass this.';
