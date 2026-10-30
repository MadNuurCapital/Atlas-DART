-- ===========================================================================
-- 0023_dashboard_payload.sql
--
-- One round trip for the dashboard, instead of five.
-- ===========================================================================
--
-- WHY THIS EXISTS
--
-- The application runs in Netlify's US East region and the database is in
-- Singapore. A single query measured about 330ms on this deployment, and
-- almost all of that is distance rather than work - the queries themselves are
-- indexed and return a handful of rows.
--
-- The dashboard asked five separate questions. Issued in parallel they still
-- did not overlap cleanly (three measured 764ms against the ~330ms a single
-- one costs), because each needs its own round trip through the pooler. So the
-- most-visited page in the app spent roughly a second waiting on the speed of
-- light before it could render anything.
--
-- This asks all five at once and returns a single JSON document. Five round
-- trips become one. Nothing about WHAT is asked changes - these are the same
-- four views and the same coaching query the page already used, with the same
-- filters - so the numbers on the page cannot move.
--
-- SECURITY
--
-- Deliberately SECURITY INVOKER, which is the default and is spelled out here
-- so that nobody "tidies" it to DEFINER. The function runs as the signed-in
-- user, every view it reads is itself security_invoker, and Row Level Security
-- applies exactly as it does to the individual queries this replaces.
--
-- It takes no user id. It reads auth.uid() instead, so there is no parameter
-- anyone could point at somebody else's figures. RLS would refuse that anyway;
-- not offering the parameter means it cannot even be attempted.
-- ===========================================================================

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

    -- Every day in the window, oldest first. The page picks today and
    -- yesterday out of this array rather than asking for them again.
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

    -- At most one row per consultant; null when no target is set, which the
    -- page renders as "No target set" rather than as zero.
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

    -- Ordered by policy type. The query this replaces had no ORDER BY, so
    -- Postgres was free to return the categories in any order it liked and the
    -- panel could reshuffle between refreshes. Deterministic is strictly
    -- better, and no figure changes.
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

    -- The coach's name is joined here rather than arriving as a PostgREST
    -- embed, which is a second lookup. The columns are listed explicitly
    -- rather than using to_jsonb(c): a bare row-to-json would silently start
    -- shipping any column added to coaching_sessions later, including one
    -- added precisely because it should not be shown.
    --
    -- The 50-row limit matches fetchMyCoaching. RLS restricts these to the
    -- caller's own sessions, exactly as it does for the query this replaces.
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
    )
  );
$$;

comment on function public.dashboard_payload(date, date, int, int) is
  'Everything the consultant dashboard needs, in one round trip. SECURITY INVOKER: RLS still applies and auth.uid() decides whose figures these are.';

-- The signed-in user is the only caller. anon has no business here, and the
-- scheduled functions use the service role, which is unaffected by grants.
revoke all on function public.dashboard_payload(date, date, int, int) from public, anon;
grant execute on function public.dashboard_payload(date, date, int, int) to authenticated;
