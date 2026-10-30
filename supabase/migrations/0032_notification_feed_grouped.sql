-- ===========================================================================
-- 0032_notification_feed_grouped.sql
--
-- A notification centre that does not grow forever.
-- ===========================================================================
--
-- The first version returned one row per case, newest first, fifty at a time.
-- With fourteen cases in two days that is a page you scroll and scroll, and
-- every row says the same sentence - "Another case submitted for the team" -
-- which carries no information at all once you have read it once.
--
-- Worse, somebody entering a batch produced a wall. Three cases logged inside
-- one minute became three identical rows.
--
-- Three changes:
--
--   1. ONE LINE PER PERSON PER DAY. "Faisal - 5 cases" rather than five rows
--      saying the same thing. It is also the truer summary: what happened is
--      that Faisal had a good day, not that five separate things occurred.
--
--   2. YOURS, THEN THE TEAM. Personal notifications are returned separately
--      so they can sit above the feed. Nothing writes them yet, but milestones
--      will, and one achievement addressed to you buried among forty
--      celebrations is an achievement nobody sees.
--
--   3. BOUNDED. Fifteen groups by default, with the total returned alongside
--      so the page knows whether to offer more. Nobody scrolls back a month to
--      re-read a celebration, but it is still there if they want it.
--
-- The day is computed in Singapore, not UTC. A case entered at 11:35 pm is
-- part of that evening's work, and grouping it into the next day because UTC
-- had rolled over would be wrong by the only clock anybody here uses.
-- ===========================================================================

create or replace function public.notification_feed(p_limit int default 15)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with team_groups as (
    select
      e.actor_id,
      -- First name only, as everywhere else. Nobody congratulates anybody by
      -- their full legal name.
      split_part(e.actor_name, ' ', 1)                    as name,
      (e.created_at at time zone 'Asia/Singapore')::date  as sg_day,
      count(*)                                            as cases,
      max(e.created_at)                                   as latest
    from public.team_events e
    group by 1, 2, 3
  )

  select jsonb_build_object(

    -- Addressed to you. Returned separately so the page can put them first.
    'personal', coalesce(
      (
        select jsonb_agg(to_jsonb(m) order by m.created_at desc)
        from (
          select
            n.id,
            n.kind,
            n.title,
            n.body,
            n.url,
            (n.read_at is not null) as read,
            n.created_at
          from public.notifications n
          where n.user_id = auth.uid()
          order by n.created_at desc
          limit p_limit
        ) m
      ),
      '[]'::jsonb
    ),

    -- One row per colleague per day, newest first.
    'team', coalesce(
      (
        select jsonb_agg(to_jsonb(g) order by g.latest desc)
        from (
          select * from team_groups
          order by latest desc
          limit p_limit
        ) g
      ),
      '[]'::jsonb
    ),

    -- How many groups exist in total, so the page knows whether a "show more"
    -- would reveal anything. Counting the groups rather than the events: the
    -- button should appear when there are more ROWS to show, not more cases.
    'team_total', (select count(*) from team_groups),

    -- Over ALL of the caller's notifications, not the page fetched. A badge
    -- reading 9 when there are thirty unread is worse than no badge.
    'unread', (
      select count(*)
      from public.notifications n
      where n.user_id = auth.uid()
        and n.read_at is null
    )
  );
$$;

comment on function public.notification_feed(int) is
  'The notification centre: your own notifications, plus the team feed grouped one line per person per day, plus the unread count.';

revoke all on function public.notification_feed(int) from public, anon;
grant execute on function public.notification_feed(int) to authenticated;
