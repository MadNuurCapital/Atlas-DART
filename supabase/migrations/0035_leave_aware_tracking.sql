-- ===========================================================================
-- 0035_leave_aware_tracking.sql
--
-- Teach the six things that chase, count and colour people about Away Mode.
-- ===========================================================================
--
-- 0034 added the record. This is the half that changes behaviour, and it is
-- deliberately a separate file: reverting it restores every function to its
-- pre-leave body without dropping a single leave record, so a rollback costs
-- nobody their holiday.
--
-- WHAT CHANGES, AND WHY IT IS ONLY SIX THINGS
--
--   missing_submissions   every reminder channel - push, email, admin digest -
--                         reaches the team through findMissing(), which calls
--                         this one function. One `and not is_away(...)` here
--                         silences all five nightly slots, the 9 PM email and
--                         the agent's line in the 6 AM admin digest. There is
--                         no second code path to remember.
--
--   team_daily            the attendance board. 'away' instead of 'missing',
--                         so blue instead of red.
--
--   monthly_compliance    the scorecard. Away days stop being days the person
--                         owed a submission for.
--
--   my_missed_days        "you have missed N days". The number a returning
--                         advisor actually sees, and the reason this feature
--                         was asked for.
--
--   app_bootstrap         the in-app banner and the Today badge, suppressed at
--                         no extra cost - the shell already makes this call on
--                         every page.
--
--   admin_overview        who is away, for the team view.
--
-- Three of these must be DROPPED rather than replaced: Postgres will not let
-- CREATE OR REPLACE change a function's output columns, and replacing one
-- in place while adding a parameter would leave an overload sitting beside it
-- making every call ambiguous. That has bitten this project before, in
-- enable-pg-cron-reminders.sql. DROP also discards the grants, so they are
-- re-issued at the end of each one.
--
-- STILL NO WRITE PATH. Everything below answers a question; nothing records
-- one. An existing submission, case or appointment cannot be affected by code
-- that only runs when somebody reads.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Nobody on leave is "missing"
-- ---------------------------------------------------------------------------
-- The single highest-value line in the feature.
--
-- CREATE OR REPLACE rather than DROP: v_missing_submissions is defined over
-- this function, and dropping it would take the view with it. The signature
-- and output columns are unchanged, so replacing is both possible and enough.
--
-- is_away() is SECURITY INVOKER and so is this, which is exactly what the
-- reminder path needs: it runs as service_role, which bypasses RLS, and
-- therefore sees the leave of all fifteen people rather than only its own.

create or replace function public.missing_submissions(p_date date default null)
returns table (
  user_id       uuid,
  full_name     text,
  email         text,
  role          text,
  business_date date
)
language sql
stable
as $$
  select p.id, p.full_name, p.email, p.role, coalesce(p_date, public.sg_today())
  from public.profiles p
  where p.active
    and not exists (
      select 1
      from public.daily_submissions ds
      where ds.user_id       = p.id
        and ds.business_date = coalesce(p_date, public.sg_today())
        and ds.status        = 'submitted'
    )
    -- Away Mode. Note this is evaluated against the date being CHASED, not
    -- against today: between midnight and 6 AM the reminders are about
    -- yesterday, so somebody whose leave ended at midnight is still not
    -- chased for the day they were away.
    and not public.is_away(p.id, coalesce(p_date, public.sg_today()));
$$;

comment on function public.missing_submissions is
  'Active people with no submitted record for the date, excluding anyone away. Every reminder channel reads this.';


-- ---------------------------------------------------------------------------
-- 2. The attendance board: blue, not red
-- ---------------------------------------------------------------------------
-- Dropped and recreated because three columns are added.
--
-- STATUS PRECEDENCE: submitted > away > draft > missing.
--
-- 'submitted' outranks 'away' so that somebody who voluntarily files a DART
-- from their hotel is credited for it and reads green - Away Mode removes an
-- obligation, it does not remove the work. The `away` boolean is returned
-- alongside, so the board can show that they were away as well as present
-- rather than having to choose.
--
-- 'away' outranks 'draft' because a half-filled form from someone on leave is
-- not an outstanding obligation, and the board exists to show obligations.

drop function if exists public.team_daily(date);

create or replace function public.team_daily(p_date date default null)
returns table (
  user_id                 uuid,
  full_name               text,
  role                    text,
  business_date           date,
  submission_id           uuid,
  status                  text,
  dials                   integer,
  talked_to               integer,
  campaign_status         text,
  in_office               boolean,
  appointments_opening    bigint,
  appointments_closing    bigint,
  appointments_follow_up  bigint,
  appointments_nomination bigint,
  signed_cases            bigint,
  active_gr               numeric,
  first_submitted_at      timestamptz,
  last_submitted_at       timestamptz,
  revision_count          integer,
  on_time                 boolean,
  away                    boolean,
  away_until              date,
  leave_reason            text
)
language sql
stable
as $$
  select
    p.id,
    p.full_name,
    p.role,
    coalesce(p_date, public.sg_today()),
    s.submission_id,
    case
      when s.status = 'submitted' then 'submitted'
      when lv.id is not null      then 'away'
      else coalesce(s.status, 'missing')
    end,
    s.dials,
    s.talked_to,
    s.campaign_status,
    s.in_office,
    s.appointments_opening,
    s.appointments_closing,
    s.appointments_follow_up,
    s.appointments_nomination,
    s.signed_cases,
    s.active_gr,
    s.first_submitted_at,
    s.last_submitted_at,
    s.revision_count,
    s.on_time,
    (lv.id is not null),
    lv.ends_on,
    lv.reason
  from public.profiles p
  left join public.v_daily_consultant_summary s
    on s.user_id = p.id
   and s.business_date = coalesce(p_date, public.sg_today())
  -- At most one row can match: leave_periods_no_overlap forbids two live
  -- periods covering the same day for one person, so this cannot fan out.
  left join public.leave_periods lv
    on lv.user_id      = p.id
   and lv.cancelled_at is null
   and coalesce(p_date, public.sg_today()) between lv.starts_on and lv.ends_on
  where p.active
  order by p.full_name;
$$;

comment on function public.team_daily is
  'The admin daily board. status precedence: submitted > away > draft > missing; the away flag is returned separately so a submission made while away still reads as present.';

revoke all on function public.team_daily(date) from public, anon;
grant execute on function public.team_daily(date) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. The scorecard: away days were never owed
-- ---------------------------------------------------------------------------
-- Dropped and recreated because away_days is added to the output.
--
-- required_days was the calendar days elapsed in the month. It is now those
-- days minus the ones the person was away, which is what "exclude Away days
-- from eligible working-day calculations" means in practice.
--
-- It becomes PER PERSON, where it used to be one number for the whole team -
-- hence the restructure into a lateral rather than a cross join on a scalar.
--
-- Note what is NOT adjusted: submitted_days, on_time_days and late_days all
-- still count only real submissions. Away Mode forgives the denominator; it
-- never inflates the numerator. Somebody away for a whole month reads 0 of 0
-- rather than 20 of 20, because they did not do twenty days of work.
--
-- The two clamps that were already here do the rest of the work for free:
-- least(…, 1) keeps an advisor who submitted voluntarily from reading 300%,
-- and greatest(…, 0) keeps missing_days from going negative.

drop function if exists public.monthly_compliance(int, int);

create or replace function public.monthly_compliance(p_year int, p_month int)
returns table (
  consultant_id  uuid,
  full_name      text,
  required_days  int,
  submitted_days bigint,
  on_time_days   bigint,
  late_days      bigint,
  missing_days   int,
  away_days      int,
  compliance     numeric
)
language sql
stable
as $$
  with bounds as (
    select
      make_date(p_year, p_month, 1)                                      as month_start,
      (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date as month_end,
      public.sg_today()                                                  as today
  ),
  req as (
    select
      case
        when b.month_start > date_trunc('month', b.today)::date then 0
        when date_trunc('month', b.today)::date = b.month_start
          then extract(day from b.today)::int
        else extract(day from b.month_end)::int
      end as calendar_days,
      b.month_start,
      b.month_end,
      least(b.month_end, b.today) as counted_to
    from bounds b
  ),
  person as (
    select
      p.id,
      p.full_name,
      r.month_start,
      r.month_end,
      r.counted_to,
      r.calendar_days,
      -- Only the elapsed part of the month. A future month gives an inverted
      -- window, which away_days() clamps to 0 rather than returning a negative
      -- that would quietly raise required_days above the calendar.
      public.away_days(p.id, r.month_start, r.counted_to) as away_days
    from public.profiles p
    cross join req r
    where p.active
  ),
  eligible as (
    select
      pe.*,
      greatest(pe.calendar_days - pe.away_days, 0)::int as required_days
    from person pe
  )
  select
    e.id,
    e.full_name,
    e.required_days,
    count(s.submission_id) filter (where s.status = 'submitted')                    as submitted_days,
    count(s.submission_id) filter (where s.status = 'submitted' and s.on_time)      as on_time_days,
    count(s.submission_id) filter (where s.status = 'submitted' and not s.on_time)  as late_days,
    greatest(e.required_days
             - count(s.submission_id) filter (where s.status = 'submitted'), 0)::int as missing_days,
    e.away_days,
    case
      when e.required_days <= 0 then 1::numeric
      else least(
        count(s.submission_id) filter (where s.status = 'submitted')::numeric
          / e.required_days, 1)
    end as compliance
  from eligible e
  left join public.v_daily_consultant_summary s
    on s.user_id = e.id
   and s.business_date between e.month_start and e.counted_to
  group by e.id, e.full_name, e.required_days, e.away_days
  order by e.full_name;
$$;

comment on function public.monthly_compliance is
  'Decision D7: required days for the current month are days elapsed, now less the days the person was away. Submitted, on-time and late counts are real submissions only - leave forgives the denominator, never the numerator.';

revoke all on function public.monthly_compliance(int, int) from public, anon;
grant execute on function public.monthly_compliance(int, int) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. "You have missed N days" must not count a holiday
-- ---------------------------------------------------------------------------
-- This is the number the feature was asked for. Before this, coming back from
-- a week away greeted somebody with "You have missed 7 days" on the dashboard
-- of the app that had already chased them thirty-five times while they were
-- out of the country.
--
-- The window is the closed days since the last submission: last_submitted + 1
-- through yesterday. Today is still never counted, for the reason it never
-- was - at ten in the morning nobody has submitted today, and counting it
-- would tell the whole team they had missed a day, every morning.
--
-- away_days is returned too, so the dashboard can say that the gap was leave
-- rather than silently showing nothing and leaving the advisor to wonder
-- whether the app noticed.

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
  ),
  gap as (
    select
      l.submitted_on,
      -- Closed days with no submission, before leave is considered.
      greatest((n.d - 1) - l.submitted_on, 0) as raw_missed,
      case
        when (n.d - 1) > l.submitted_on
          then public.away_days(auth.uid(), l.submitted_on + 1, n.d - 1)
        else 0
      end as away_in_gap
    from last_day l, now_date n
    where l.submitted_on is not null
  )
  select jsonb_build_object(
    'ever_submitted', (select submitted_on is not null from last_day),
    'last_submitted', (select submitted_on from last_day),

    -- Away days are forgiven, not merely hidden: the count is the closed days
    -- in the gap that the person was actually expected to submit on.
    'missed', coalesce(
      (select greatest(g.raw_missed - g.away_in_gap, 0) from gap g),
      0
    ),

    -- For the dashboard's wording. A gap of 7 that is entirely leave should
    -- read differently from no gap at all.
    'away_days', coalesce((select g.away_in_gap from gap g), 0),

    'submitted_today', exists (
      select 1 from public.daily_submissions d, now_date n
      where d.user_id = auth.uid()
        and d.status = 'submitted'
        and d.business_date = n.d
    ),

    -- Whether they are away right now, so the notice can stay quiet during
    -- leave rather than counting down to an obligation that is suspended.
    'away_now', public.is_away(auth.uid(), (select d from now_date))
  );
$$;

comment on function public.my_missed_days(date) is
  'Consecutive closed days with no submission, ending yesterday, less any day the person was away. Today is never counted against anybody until it closes.';

revoke all on function public.my_missed_days(date) from public, anon;
grant execute on function public.my_missed_days(date) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. The app shell: suppress the banner, show the indicator
-- ---------------------------------------------------------------------------
-- Two different dates, deliberately.
--
--   nag_away  is about the date being CHASED, which between midnight and 6 AM
--             is yesterday. It decides whether the banner and the Today badge
--             appear at all.
--
--   away      is about TODAY, and drives the blue "Away Mode is active"
--             indicator. At 2 AM on the morning after leave ends, the banner
--             must stay silent about yesterday while the indicator is already
--             gone - one date cannot answer both.
--
-- Both ride the call the shell already makes on every page, so the whole
-- feature costs the layout zero additional round trips. At ~330ms between US
-- East and Singapore that is the difference between free and noticeable.
--
-- Only three fields of the leave row are shipped. The shell renders a date and
-- a label; sending the row would put somebody's medical note into the payload
-- of every page they load.

create or replace function public.app_bootstrap(p_nag_date date)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(

    'profile', (
      select to_jsonb(p)
      from public.profiles p
      where p.id = auth.uid()
    ),

    'nag_status', (
      select d.status
      from public.daily_submissions d
      where d.user_id = auth.uid()
        and d.business_date = p_nag_date
    ),

    -- Null when not away today, which is what the indicator keys on.
    'away', (
      select jsonb_build_object(
               'starts_on', lp.starts_on,
               'ends_on',   lp.ends_on,
               'reason',    lp.reason
             )
      from public.leave_periods lp
      where lp.user_id      = auth.uid()
        and lp.cancelled_at is null
        and public.sg_today() between lp.starts_on and lp.ends_on
      limit 1
    ),

    'nag_away', public.is_away(auth.uid(), p_nag_date)
  );
$$;

comment on function public.app_bootstrap(date) is
  'The app shell in one round trip: who is signed in, whether they have submitted the day being chased, and their Away Mode state. SECURITY INVOKER - RLS still decides.';

revoke all on function public.app_bootstrap(date) from public, anon;
grant execute on function public.app_bootstrap(date) to authenticated;


-- ---------------------------------------------------------------------------
-- 6. The dashboard's own round trip
-- ---------------------------------------------------------------------------
-- One more key on the payload the dashboard already fetches, so the Leave &
-- Away Mode card can show the active or next period without a second call.
--
-- Active first, then the soonest upcoming one. Past periods are not included:
-- the card is a summary with a link to the full screen, and history belongs
-- there.

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
    'missed',      public.my_missed_days(),

    'leave', (
      select jsonb_build_object(
               'id',        lp.id,
               'starts_on', lp.starts_on,
               'ends_on',   lp.ends_on,
               'reason',    lp.reason,
               'active',    (public.sg_today() between lp.starts_on and lp.ends_on)
             )
      from public.leave_periods lp
      where lp.user_id      = auth.uid()
        and lp.cancelled_at is null
        and lp.ends_on     >= public.sg_today()
      order by lp.starts_on
      limit 1
    )
  );
$$;


-- ---------------------------------------------------------------------------
-- 7. Who is away, for the team view
-- ---------------------------------------------------------------------------
-- Name, status, start date, expected return - and nothing else. No reason, and
-- no note: a manager needs to know who is out and until when, and self-declared
-- medical leave is not something to publish on a dashboard in order to answer
-- that. The reason is on team_daily for the person's own row and visible to
-- admins there; this list is the roster.
--
-- Rides the call the admin overview already makes. RLS does the access control:
-- leave_select returns other people's rows only to an admin, so a consultant
-- who called this function directly would get their own leave and nothing else.

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
    ),

    'away_now', coalesce(
      (
        select jsonb_agg(
                 jsonb_build_object(
                   'user_id',   lp.user_id,
                   'full_name', pr.full_name,
                   'starts_on', lp.starts_on,
                   'ends_on',   lp.ends_on
                 )
                 order by lp.ends_on, pr.full_name
               )
        from public.leave_periods lp
        join public.profiles pr on pr.id = lp.user_id
        where lp.cancelled_at is null
          and pr.active
          and p_date between lp.starts_on and lp.ends_on
      ),
      '[]'::jsonb
    )
  );
$$;

comment on function public.admin_overview(date, int, int) is
  'The admin overview in one round trip, including who is away on the date. SECURITY INVOKER - the functions and views it reads each apply their own policies.';

revoke all on function public.admin_overview(date, int, int) from public, anon;
grant execute on function public.admin_overview(date, int, int) to authenticated;
