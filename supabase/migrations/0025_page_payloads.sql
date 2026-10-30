-- ===========================================================================
-- 0025_page_payloads.sql
--
-- One round trip for /today and for the admin overview.
-- ===========================================================================
--
-- The third and last of the payload functions, following 0023 (dashboard) and
-- 0024 (app shell). Same reasoning throughout: the app runs in US East, the
-- database is in Singapore, and a round trip costs about 330ms of distance
-- regardless of how little work it does.
--
-- /today is the page the whole application exists for - fifteen people open it
-- every evening - and it asked two questions. The admin overview asked three.
--
-- Both are SECURITY INVOKER and read auth.uid(); neither takes a user id.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- /today - the day's submission and its appointment rows
-- ---------------------------------------------------------------------------
--
-- The edit window is deliberately NOT enforced here. A consultant may READ any
-- of their own days - that is how the arrows at the top of the page work - and
-- what the 7-day window governs is writing. That rule lives in RLS, where it
-- binds every path to the table rather than only this one.

create or replace function public.day_payload(p_date date)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(

    -- Null when nothing has been recorded for the day yet, which the form
    -- renders as an empty submission rather than as an error.
    'submission', (
      select to_jsonb(d)
      from public.daily_submissions d
      where d.user_id = auth.uid()
        and d.business_date = p_date
    ),

    -- Oldest first, matching the order the page asked for. AO, AC, FU and N
    -- are counted from these rows and never typed, so a row going missing here
    -- would silently change someone's totals.
    'appointments', coalesce(
      (
        select jsonb_agg(to_jsonb(a) order by a.created_at)
        from public.appointment_activities a
        where a.user_id = auth.uid()
          and a.business_date = p_date
      ),
      '[]'::jsonb
    )
  );
$$;

comment on function public.day_payload(date) is
  'The daily submission and its appointments, in one round trip. SECURITY INVOKER - RLS decides whose day this is.';

revoke all on function public.day_payload(date) from public, anon;
grant execute on function public.day_payload(date) to authenticated;


-- ---------------------------------------------------------------------------
-- The admin overview - the team's day, their targets, and compliance
-- ---------------------------------------------------------------------------
--
-- team_daily() and monthly_compliance() are themselves SECURITY INVOKER, so
-- calling them from here changes nothing about who may see what: a consultant
-- who somehow reached this function would get exactly what those functions
-- give a consultant, which is their own row and nothing else.
--
-- The ORDER BY on the team rows repeats team_daily's own `order by
-- p.full_name`. jsonb_agg over a set-returning function happens to preserve
-- input order today, but that is not promised anywhere, and an admin board
-- that reshuffles its fifteen names between refreshes would be maddening.

create or replace function public.admin_overview(
  p_date  date,
  p_year  int,
  p_month int
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(

    'team', coalesce(
      (
        select jsonb_agg(to_jsonb(t) order by t.full_name)
        from public.team_daily(p_date) t
      ),
      '[]'::jsonb
    ),

    'targets', coalesce(
      (
        select jsonb_agg(to_jsonb(s) order by s.full_name)
        from public.v_target_shortfall s
      ),
      '[]'::jsonb
    ),

    'compliance', coalesce(
      (
        select jsonb_agg(to_jsonb(c) order by c.full_name)
        from public.monthly_compliance(p_year, p_month) c
      ),
      '[]'::jsonb
    )
  );
$$;

comment on function public.admin_overview(date, int, int) is
  'The admin overview in one round trip. SECURITY INVOKER - the functions and views it reads each apply their own policies.';

revoke all on function public.admin_overview(date, int, int) from public, anon;
grant execute on function public.admin_overview(date, int, int) to authenticated;
