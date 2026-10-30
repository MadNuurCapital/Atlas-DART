-- ===========================================================================
-- 0027_notification_feed.sql
--
-- The notification centre's contents, in one round trip.
-- ===========================================================================
--
-- The centre shows two streams woven together, newest first: things addressed
-- to you, and things the team did. Reading them as two queries would reopen
-- exactly the problem 0023-0025 closed, so they are merged in Postgres and
-- returned once.
--
-- The unread COUNT is returned alongside, because the badge on the bell needs
-- it and asking for it separately would be a third round trip for one integer.
--
-- SECURITY INVOKER. `notifications` is restricted to the caller by its own
-- policy and `team_events` is readable by every signed-in colleague by its
-- own policy; this function adds no reach of its own and merely stops the two
-- being asked for separately.
-- ===========================================================================

create or replace function public.notification_feed(p_limit int default 50)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with mine as (
    select
      n.id,
      'personal'::text as source,
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
  ),
  team as (
    select
      e.id,
      'team'::text as source,
      e.kind,
      -- The copy lives here rather than in the client so that the feed, the
      -- live toast and any future email all say the same sentence.
      e.actor_name || ' just submitted a case!' as title,
      null::text as body,
      '/cases'::text as url,
      -- A shared row has no per-person read state. Treating team events as
      -- always-read keeps them out of the unread badge, which is reserved for
      -- things addressed to you and actually needing attention.
      true as read,
      e.created_at
    from public.team_events e
    order by e.created_at desc
    limit p_limit
  ),
  merged as (
    select * from mine
    union all
    select * from team
  )
  select jsonb_build_object(

    'items', coalesce(
      (
        select jsonb_agg(to_jsonb(m) order by m.created_at desc)
        from (select * from merged order by created_at desc limit p_limit) m
      ),
      '[]'::jsonb
    ),

    -- Counted over ALL of the caller's notifications, not just the page that
    -- was fetched: a badge reading "9" when there are thirty unread would be
    -- worse than no badge.
    'unread', (
      select count(*)
      from public.notifications n
      where n.user_id = auth.uid()
        and n.read_at is null
    )
  );
$$;

comment on function public.notification_feed(int) is
  'The notification centre - personal notifications and team events merged, newest first - plus the unread count for the bell.';

revoke all on function public.notification_feed(int) from public, anon;
grant execute on function public.notification_feed(int) to authenticated;


-- ---------------------------------------------------------------------------
-- Marking things read
-- ---------------------------------------------------------------------------
--
-- A function rather than letting the client UPDATE directly, so "read" cannot
-- be set back to unread and nothing else on the row can be touched. The policy
-- would already confine it to the caller's own rows; this confines it to the
-- one column that is theirs to change.

create or replace function public.mark_notifications_read()
returns int
language sql
volatile
security invoker
set search_path = public
as $$
  with updated as (
    update public.notifications
       set read_at = now()
     where user_id = auth.uid()
       and read_at is null
    returning 1
  )
  select count(*)::int from updated;
$$;

comment on function public.mark_notifications_read() is
  'Marks all of the caller''s unread notifications read. Returns how many were changed.';

revoke all on function public.mark_notifications_read() from public, anon;
grant execute on function public.mark_notifications_read() to authenticated;
