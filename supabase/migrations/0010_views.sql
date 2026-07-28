-- ---------------------------------------------------------------------------
-- 0010 - Reporting views and report functions.
--
-- EVERY view here is declared `security_invoker = true`. Without that flag a
-- view runs as its owner and becomes a complete Row Level Security bypass -
-- any consultant could read the whole team through it. This is the single most
-- important line in the file.
--
-- Nothing here stores a calculated total. The dashboard and the Excel export
-- read these same objects, which is what keeps the two from ever disagreeing.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Daily summary, one row per submission, with appointment counts and the GR
-- credited to that date. on_time is DERIVED, never stored, so a later
-- correction to an originally on-time submission stays on time.
-- ---------------------------------------------------------------------------
create or replace view public.v_daily_consultant_summary
with (security_invoker = true) as
select
  ds.id                      as submission_id,
  ds.user_id,
  p.full_name,
  p.role,
  ds.business_date,
  ds.dials,
  ds.talked_to,
  ds.campaign_status,
  ds.in_office,
  ds.notes,
  ds.status,
  ds.first_submitted_at,
  ds.last_submitted_at,
  ds.revision_count,
  coalesce(a.opening,    0)  as appointments_opening,
  coalesce(a.closing,    0)  as appointments_closing,
  coalesce(a.follow_up,  0)  as appointments_follow_up,
  coalesce(a.nomination, 0)  as appointments_nomination,
  coalesce(a.total,      0)  as appointments_total,
  coalesce(c.signed_cases, 0) as signed_cases,
  coalesce(c.active_gr,  0)::numeric(14, 2)  as active_gr,
  coalesce(c.active_ape, 0)::numeric(14, 2)  as active_ape,
  (ds.status = 'submitted'
    and ds.first_submitted_at is not null
    and ds.first_submitted_at <= public.sg_deadline(ds.business_date)) as on_time
from public.daily_submissions ds
join public.profiles p on p.id = ds.user_id
left join lateral (
  select
    count(*) filter (where aa.appointment_type = 'opening')    as opening,
    count(*) filter (where aa.appointment_type = 'closing')    as closing,
    count(*) filter (where aa.appointment_type = 'follow_up')  as follow_up,
    count(*) filter (where aa.appointment_type = 'nomination') as nomination,
    count(*)                                                   as total
  from public.appointment_activities aa
  where aa.daily_submission_id = ds.id
) a on true
left join lateral (
  select
    count(*)              as signed_cases,
    sum(cs.gr_amount)     as active_gr,
    sum(cs.ape_amount)    as active_ape
  from public.cases cs
  where cs.consultant_id  = ds.user_id
    and cs.date_submitted = ds.business_date
    and cs.status         = 'active'
) c on true;

-- ---------------------------------------------------------------------------
-- Month-to-date and year-to-date GR per person. Aggregated over date_submitted
-- (D16) and over active cases only (D6).
-- ---------------------------------------------------------------------------
create or replace view public.v_monthly_consultant_gr
with (security_invoker = true) as
select
  c.consultant_id,
  extract(year  from c.date_submitted)::int  as year,
  extract(month from c.date_submitted)::int  as month,
  count(*)                                   as active_cases,
  sum(c.gr_amount)::numeric(14, 2)           as active_gr,
  sum(c.ape_amount)::numeric(14, 2)          as active_ape
from public.cases c
where c.status = 'active'
group by c.consultant_id,
         extract(year  from c.date_submitted),
         extract(month from c.date_submitted);

create or replace view public.v_yearly_consultant_gr
with (security_invoker = true) as
select
  c.consultant_id,
  extract(year from c.date_submitted)::int as year,
  count(*)                                 as active_cases,
  sum(c.gr_amount)::numeric(14, 2)         as active_gr,
  sum(c.ape_amount)::numeric(14, 2)        as active_ape
from public.cases c
where c.status = 'active'
group by c.consultant_id, extract(year from c.date_submitted);

-- ---------------------------------------------------------------------------
-- Case totals including the cancelled side, so an admin can see what was
-- written versus what survived without cancelled work polluting any total.
-- ---------------------------------------------------------------------------
create or replace view public.v_case_totals
with (security_invoker = true) as
select
  p.id                                as consultant_id,
  p.full_name,
  count(c.id) filter (where c.status = 'active')                          as active_cases,
  count(c.id) filter (where c.status = 'cancelled')                       as cancelled_cases,
  coalesce(sum(c.gr_amount)  filter (where c.status = 'active'), 0)::numeric(14, 2)    as active_gr,
  coalesce(sum(c.ape_amount) filter (where c.status = 'active'), 0)::numeric(14, 2)    as active_ape,
  coalesce(sum(c.gr_amount)  filter (where c.status = 'cancelled'), 0)::numeric(14, 2) as cancelled_gr
from public.profiles p
left join public.cases c on c.consultant_id = p.id
group by p.id, p.full_name;

-- ---------------------------------------------------------------------------
-- Case Mix by Category (D18) - reproduces the cross-tab in the original
-- workbook, which counts Counts and APE per policy type.
-- ---------------------------------------------------------------------------
create or replace view public.v_case_mix_by_category
with (security_invoker = true) as
select
  c.consultant_id,
  extract(year  from c.date_submitted)::int as year,
  extract(month from c.date_submitted)::int as month,
  c.policy_type,
  count(*)                                  as case_count,
  sum(c.ape_amount)::numeric(14, 2)         as ape,
  sum(c.gr_amount)::numeric(14, 2)          as gr
from public.cases c
where c.status = 'active'
group by c.consultant_id,
         extract(year  from c.date_submitted),
         extract(month from c.date_submitted),
         c.policy_type;

-- ---------------------------------------------------------------------------
-- Pending Inception - active cases with no inception date yet. These already
-- count for GR (D16); this view exists so business that quietly never goes live
-- does not sit unnoticed in the totals.
-- ---------------------------------------------------------------------------
create or replace view public.v_pending_inception
with (security_invoker = true) as
select
  c.consultant_id,
  count(*)                          as pending_cases,
  sum(c.gr_amount)::numeric(14, 2)  as pending_gr,
  sum(c.ape_amount)::numeric(14, 2) as pending_ape,
  min(c.date_submitted)             as oldest_submitted
from public.cases c
where c.status = 'active'
  and c.date_incepted is null
group by c.consultant_id;

-- ---------------------------------------------------------------------------
-- Targets and shortfall for the current month and year.
--
-- Monthly target resolution (D17): an explicit monthly override wins, otherwise
-- the yearly figure divided by 12. NULL when neither exists, which the UI shows
-- as "No target set" rather than as a zero target.
--
-- Shortfall is clamped at zero and achievement is NULL rather than a division
-- by zero when there is no usable target.
-- ---------------------------------------------------------------------------
create or replace view public.v_target_shortfall
with (security_invoker = true) as
with bounds as (
  select
    public.sg_today()                                as as_of,
    extract(year  from public.sg_today())::int       as yr,
    extract(month from public.sg_today())::int       as mo
)
select
  p.id                                as consultant_id,
  p.full_name,
  b.as_of,
  b.yr                                as year,
  b.mo                                as month,

  coalesce(m.active_gr, 0)::numeric(14, 2)  as month_to_date_gr,
  coalesce(y.active_gr, 0)::numeric(14, 2)  as year_to_date_gr,
  coalesce(m.active_cases, 0)               as month_active_cases,
  coalesce(y.active_cases, 0)               as year_active_cases,

  mt.monthly_target,
  yt.yearly_target,

  case when mt.monthly_target is null then null
       else greatest(mt.monthly_target - coalesce(m.active_gr, 0), 0)
  end::numeric(14, 2)                  as monthly_shortfall,

  case when yt.yearly_target is null then null
       else greatest(yt.yearly_target - coalesce(y.active_gr, 0), 0)
  end::numeric(14, 2)                  as yearly_shortfall,

  case when mt.monthly_target is null or mt.monthly_target <= 0 then null
       else (coalesce(m.active_gr, 0) / mt.monthly_target)
  end                                  as monthly_achievement,

  case when yt.yearly_target is null or yt.yearly_target <= 0 then null
       else (coalesce(y.active_gr, 0) / yt.yearly_target)
  end                                  as yearly_achievement
from public.profiles p
cross join bounds b
left join lateral (
  select ct.gr_target as yearly_target
  from public.consultant_targets ct
  where ct.consultant_id = p.id
    and ct.period_type   = 'yearly'
    and ct.year          = b.yr
) yt on true
left join lateral (
  select coalesce(
    (select ct.gr_target
       from public.consultant_targets ct
      where ct.consultant_id = p.id
        and ct.period_type   = 'monthly'
        and ct.year          = b.yr
        and ct.month         = b.mo),
    yt.yearly_target / 12
  ) as monthly_target
) mt on true
left join public.v_monthly_consultant_gr m
  on m.consultant_id = p.id and m.year = b.yr and m.month = b.mo
left join public.v_yearly_consultant_gr y
  on y.consultant_id = p.id and y.year = b.yr
where p.active;

-- ---------------------------------------------------------------------------
-- Who has not submitted today. Drives the 21:00 reminder.
-- A draft does NOT count as submitted.
-- ---------------------------------------------------------------------------
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
    );
$$;

create or replace view public.v_missing_submissions
with (security_invoker = true) as
select * from public.missing_submissions(null);

-- ---------------------------------------------------------------------------
-- The admin daily board: every active person for a given date, whether or not
-- they submitted. A LEFT JOIN rather than a filter, so missing people are rows
-- with nulls instead of silently absent.
-- ---------------------------------------------------------------------------
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
  on_time                 boolean
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
    coalesce(s.status, 'missing'),
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
    s.on_time
  from public.profiles p
  left join public.v_daily_consultant_summary s
    on s.user_id = p.id
   and s.business_date = coalesce(p_date, public.sg_today())
  where p.active
  order by p.full_name;
$$;

-- ---------------------------------------------------------------------------
-- Submission compliance for a month (D7).
--
-- Required days for the CURRENT month are the days elapsed including today, so
-- someone who has submitted every day reads 100% on the 12th rather than 40%.
-- A finished month requires all of its days. A future month requires none.
-- ---------------------------------------------------------------------------
create or replace function public.monthly_compliance(p_year int, p_month int)
returns table (
  consultant_id  uuid,
  full_name      text,
  required_days  int,
  submitted_days bigint,
  on_time_days   bigint,
  late_days      bigint,
  missing_days   int,
  compliance     numeric
)
language sql
stable
as $$
  with bounds as (
    select
      make_date(p_year, p_month, 1)                                    as month_start,
      (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date as month_end,
      public.sg_today()                                                as today
  ),
  req as (
    select
      case
        when b.month_start > date_trunc('month', b.today)::date then 0
        when date_trunc('month', b.today)::date = b.month_start
          then extract(day from b.today)::int
        else extract(day from b.month_end)::int
      end as required_days,
      b.month_start,
      b.month_end
    from bounds b
  )
  select
    p.id,
    p.full_name,
    r.required_days,
    count(s.submission_id) filter (where s.status = 'submitted')                    as submitted_days,
    count(s.submission_id) filter (where s.status = 'submitted' and s.on_time)      as on_time_days,
    count(s.submission_id) filter (where s.status = 'submitted' and not s.on_time)  as late_days,
    greatest(r.required_days
             - count(s.submission_id) filter (where s.status = 'submitted'), 0)::int as missing_days,
    case
      when r.required_days <= 0 then 1::numeric
      else least(
        count(s.submission_id) filter (where s.status = 'submitted')::numeric
          / r.required_days, 1)
    end as compliance
  from public.profiles p
  cross join req r
  left join public.v_daily_consultant_summary s
    on s.user_id = p.id
   and s.business_date between r.month_start and least(r.month_end, public.sg_today())
  where p.active
  group by p.id, p.full_name, r.required_days
  order by p.full_name;
$$;

comment on view public.v_daily_consultant_summary is
  'security_invoker view. on_time is derived from first_submitted_at, never stored.';
comment on function public.monthly_compliance is
  'Decision D7: required days for the current month are days elapsed, so mid-month percentages read truthfully.';
