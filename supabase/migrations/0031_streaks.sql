-- ===========================================================================
-- 0031_streaks.sql
--
-- How many days in a row, and the best run there has ever been.
-- ===========================================================================
--
-- COMPUTED, NEVER STORED.
--
-- The obvious design is a `streak` column on profiles that a trigger
-- increments. It is also wrong. A stored counter drifts the moment anything
-- unusual happens - a submission edited after the fact, a day backfilled by
-- an admin, a trigger that failed once - and a streak that says 14 when the
-- days say 9 is worse than no streak at all, because nobody can tell which
-- number to believe.
--
-- This derives both figures from daily_submissions every time. With fifteen
-- people and one row per person per day that is a few hundred rows, which
-- Postgres counts faster than it could read a cached answer off disk.
--
--
-- WHAT COUNTS AS A DAY
--
-- A SUBMITTED day. Not an on-time one.
--
-- That is a deliberate choice and worth stating, because the obvious
-- alternative - requiring on_time - quietly creates a reason NOT to submit.
-- Somebody who realises at 12:30am that they forgot has already lost the
-- streak under that rule, so the app would be telling them their submission
-- no longer matters. It does matter: the figures are the point, and a late
-- one is worth far more than a missing one.
--
-- Lateness is already measured, separately and visibly, by the compliance
-- percentage the dashboard has always shown. Two honest signals beat one
-- that tries to carry both meanings and discourages the behaviour it is
-- supposed to encourage.
--
--
-- WHY TODAY DOES NOT BREAK IT
--
-- A streak ends at today OR yesterday. At ten in the morning nobody has
-- submitted today yet, and a counter that reads 0 until the evening would be
-- wrong every morning. The day only counts against anyone once it has closed.
-- ===========================================================================

create or replace function public.my_streaks()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with days as (
    select d.business_date
    from public.daily_submissions d
    where d.user_id = auth.uid()
      and d.status = 'submitted'
  ),

  -- Gaps and islands: subtracting a row number from consecutive dates gives
  -- every date in an unbroken run the same value, so runs can be grouped.
  grouped as (
    select
      business_date,
      business_date
        - (row_number() over (order by business_date))::int as run_key
    from days
  ),

  runs as (
    select
      count(*)           as length,
      max(business_date) as ends_on
    from grouped
    group by run_key
  )

  select jsonb_build_object(

    -- The run still alive. A run ending yesterday is still alive, because
    -- today is not over; one ending the day before is finished.
    'current', coalesce(
      (
        select r.length
        from runs r
        where r.ends_on >= public.sg_today() - 1
        order by r.ends_on desc
        limit 1
      ),
      0
    ),

    'longest', coalesce((select max(length) from runs), 0),

    -- So the dashboard can say "submit today to keep it going" rather than
    -- leaving someone to work out whether they already have.
    'submitted_today', exists (
      select 1 from days where business_date = public.sg_today()
    ),

    'total_days', (select count(*) from days)
  );
$$;

comment on function public.my_streaks() is
  'Current and longest run of submitted days, derived from daily_submissions rather than stored. SECURITY INVOKER: auth.uid() decides whose streak this is.';

revoke all on function public.my_streaks() from public, anon;
grant execute on function public.my_streaks() to authenticated;


-- ---------------------------------------------------------------------------
-- Fold it into the dashboard's single round trip
-- ---------------------------------------------------------------------------
--
-- Added as one more key rather than fetched separately, so the page still
-- makes exactly one call. The existing keys are untouched, which is why the
-- parity tests from 0023 continue to pass unchanged.

create or replace function public.dashboard_payload(
  p_from  date,
  p_to    date,
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

    'days', coalesce(
      (
        select jsonb_agg(to_jsonb(d) order by d.business_date)
        from public.v_daily_consultant_summary d
        where d.user_id = auth.uid()
          and d.business_date >= p_from
          and d.business_date <= p_to
      ),
      '[]'::jsonb
    ),

    'target', (
      select to_jsonb(t)
      from public.v_target_shortfall t
      where t.consultant_id = auth.uid()
      limit 1
    ),

    'pending', (
      select to_jsonb(p)
      from public.v_pending_inception p
      where p.consultant_id = auth.uid()
      limit 1
    ),

    'mix', coalesce(
      (
        select jsonb_agg(to_jsonb(m) order by m.policy_type)
        from public.v_case_mix_by_category m
        where m.consultant_id = auth.uid()
          and m.year = p_year
          and m.month = p_month
      ),
      '[]'::jsonb
    ),

    'coaching', coalesce(
      (
        select jsonb_agg(row_to_json(s) order by s.scheduled_at asc nulls last)
        from (
          select
            c.id, c.consultant_id, c.coach_id, c.title, c.category,
            c.message, c.location, c.requested_topic, c.agenda,
            c.scheduled_at, c.status, c.acknowledged_at, c.cancelled_at,
            c.cancellation_reason, c.created_at,
            p.full_name as coach_name
          from public.coaching_sessions c
          left join public.profiles p on p.id = c.coach_id
          order by c.scheduled_at asc nulls last
          limit 50
        ) s
      ),
      '[]'::jsonb
    ),

    'streaks', public.my_streaks()
  );
$$;
