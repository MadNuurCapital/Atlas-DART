-- ===========================================================================
-- 0030_celebration_wording.sql
--
-- One sentence, said the same way in all three places.
-- ===========================================================================
--
-- A case submitted now reaches a colleague three ways: a push notification on
-- their phone, a toast if they happen to have the app open, and a line in the
-- notification centre afterwards.
--
-- The wording lives here, in the feed, and in the push sender, so it has to
-- agree. Seeing "Congratulations Faisal!" on the lock screen and then
-- "Faisal just submitted a case!" under the bell reads as two separate events.
--
-- Only the first name. "Congratulations Muhammad Faisal bin Abdullah!" is not
-- how anybody congratulates anybody, and split_part on the first space is how
-- the reminder emails already do it.
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
      '🎉 Congratulations ' || split_part(e.actor_name, ' ', 1) || '!' as title,
      'Another case submitted for the team.'::text as body,
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
