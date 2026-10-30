-- ===========================================================================
-- 0031_month_cases.sql
--
-- Cases this month, against your own best start. And the days you have missed.
-- ===========================================================================
--
-- This replaces a submission streak that was written and then withdrawn before
-- it ever reached production. A streak measured whether somebody had filled in
-- a form - an administrative habit, and really a thing management wants. Cases
-- are business they actually wrote. That is what an advisor is proud of, and it
-- is what belongs at the top of their dashboard.
--
--
-- WHY "BEST AT THIS POINT IN THE MONTH" AND NOT "BEST MONTH"
--
-- Comparing a month in progress against a finished one is unfair in a way
-- that reads as an accusation. On the 3rd you have 2 cases and your best
-- month was 9, so the tile says you are behind - when you are three days in
-- and doing fine.
--
-- So previous months are counted only up to the SAME DAY OF THE MONTH. "5
-- cases by the 12th, your best start to a month yet" is a comparison that can
-- be won on any day of the month, which is the entire point of putting it
-- there.
--
-- Calendar months rather than a rolling 30 days, even though rolling would
-- avoid the counter resetting to zero on the 1st. Targets, reporting and the
-- monthly export all run on calendar months; a second, competing notion of
-- "this month" would confuse more than the reset costs.
--
--
-- ACTIVE CASES ONLY
--
-- A cancelled case leaves every total, retroactively, exactly as it does for
-- GR. That means a personal best can be taken back. It is the honest answer:
-- a record built on a case that was cancelled was never a record.
-- ===========================================================================

-- Postgres keeps overloads side by side, so a previous no-argument version
-- would sit beside the new one with a DEFAULT and make every call ambiguous.
-- Dropped explicitly rather than replaced.
drop function if exists public.my_month_cases();
drop function if exists public.my_missed_days();

--
-- p_as_of exists so this can be asked "what did it look like on the 12th".
-- Without it the behaviour that matters - the comparison against the same
-- slice of an earlier month - is only exercisable on whatever day the tests
-- happen to run, and is untestable at all on the 31st, when no earlier month
-- has a later day to be ahead on. The application never passes it.
create or replace function public.my_month_cases(p_as_of date default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with today as (
    select coalesce(p_as_of, public.sg_today()) as d
  ),
  mine as (
    select c.date_submitted
    from public.cases c
    where c.consultant_id = auth.uid()
      and c.status = 'active'
  ),
  by_month as (
    select
      date_trunc('month', m.date_submitted)::date as month_start,
      count(*)                                    as total,
      -- The same slice of an earlier month: everything up to today's day
      -- number. On the 12th, the first 12 days of every previous month.
      count(*) filter (
        where extract(day from m.date_submitted) <= extract(day from t.d)
      )                                           as by_this_day
    from mine m
    cross join today t
    group by 1
  ),
  current_month as (
    select coalesce(
      (select b.total from by_month b, today t
        where b.month_start = date_trunc('month', t.d)::date),
      0
    ) as total
  ),
  previous as (
    select
      coalesce(max(b.by_this_day), 0) as best_start,
      coalesce(max(b.total), 0)       as best_total
    from by_month b, today t
    where b.month_start < date_trunc('month', t.d)::date
  )

  select jsonb_build_object(

    'this_month', c.total,

    -- The figure to beat, measured at the same point in the month.
    'best_start', p.best_start,

    -- The best any finished month ever reached, for context rather than
    -- comparison.
    'best_total', p.best_total,

    'last_month', coalesce(
      (
        select b.total from by_month b, today t
         where b.month_start = (date_trunc('month', t.d) - interval '1 month')::date
      ),
      0
    ),

    -- Strictly greater, and never for a zero: "0 cases, your best start yet"
    -- would be absurd in the first month and insulting in any other.
    'is_best_start', (c.total > p.best_start and c.total > 0),

    'month_label', to_char((select d from today), 'FMMonth')
  )
  from current_month c, previous p;
$$;

comment on function public.my_month_cases(date) is
  'Active cases submitted this month, with the same slice of previous months to compare against. SECURITY INVOKER.';

revoke all on function public.my_month_cases(date) from public, anon;
grant execute on function public.my_month_cases(date) to authenticated;


-- ---------------------------------------------------------------------------
-- How many days somebody has gone without submitting
-- ---------------------------------------------------------------------------
--
-- The inverse of the streak, and the part of it worth keeping. A person who
-- missed today is ordinary; a person who has missed five days has stopped,
-- and that is worth seeing.
--
-- Counted over CLOSED days only - yesterday and earlier - for the same reason
-- the streak ended at yesterday. At ten in the morning nobody has submitted
-- today, and counting it would tell everybody they had missed a day, every
-- morning.
--
-- Null when they have never submitted at all, which is a different thing from
-- having lapsed and should read differently.

-- p_as_of as above: the interesting behaviour is "today does not count yet",
-- which is awkward to assert against a moving clock.
create or replace function public.my_missed_days(p_as_of date default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with now_date as (
    select coalesce(p_as_of, public.sg_today()) as d
  ),
  last_day as (
    select max(d.business_date) as submitted_on
    from public.daily_submissions d
    where d.user_id = auth.uid()
      and d.status = 'submitted'
  )
  select jsonb_build_object(
    'ever_submitted', (select submitted_on is not null from last_day),
    'last_submitted', (select submitted_on from last_day),
    'missed', coalesce(
      (
        select greatest((n.d - 1) - l.submitted_on, 0)
        from last_day l, now_date n
        where l.submitted_on is not null
      ),
      0
    ),
    'submitted_today', exists (
      select 1 from public.daily_submissions d, now_date n
      where d.user_id = auth.uid()
        and d.status = 'submitted'
        and d.business_date = n.d
    )
  );
$$;

comment on function public.my_missed_days(date) is
  'Consecutive closed days with no submission, ending yesterday. Today is never counted against anybody until it closes.';

revoke all on function public.my_missed_days(date) from public, anon;
grant execute on function public.my_missed_days(date) to authenticated;


-- ---------------------------------------------------------------------------
-- Swap them into the dashboard's single round trip
-- ---------------------------------------------------------------------------
--
-- `streaks` is replaced by `cases_month` and `missed`. The page still makes
-- one call; the other keys are untouched, so the parity tests from 0023
-- continue to pass.

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

    'cases_month', public.my_month_cases(),
    'missed',      public.my_missed_days()
  );
$$;


-- Defensive. The withdrawn streak migration was circulated before it was
-- replaced, so a database may have had my_streaks() applied by hand. A no-op
-- where it was not, and a tidy-up where it was: an unused function that still
-- compiles is the kind of thing somebody wires back up in a year without
-- knowing it was deliberately retired.
drop function if exists public.my_streaks();
