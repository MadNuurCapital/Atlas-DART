-- ---------------------------------------------------------------------------
-- 0021 - A cancelled session leaves the consultant's view immediately.
--
-- 0018 kept cancelled and declined sessions visible for a week, so nobody was
-- left waiting for a meeting that was not happening. In use that turned out to
-- be clutter: the person has already had a notification telling them, and the
-- card then sits on their dashboard with nothing for them to do about it.
--
-- Declined requests are deliberately NOT changed. A consultant who asked for
-- coaching is waiting for an answer, and an answer that arrives as silence -
-- the request simply vanishing - reads as having been ignored. They keep the
-- week, and the reason with it.
--
-- Only the SELECT policy changes. The rows themselves are untouched: cancelled
-- coaching stays in full for admins and in the export, as it always did.
-- ---------------------------------------------------------------------------

drop policy if exists coaching_select on public.coaching_sessions;
create policy coaching_select on public.coaching_sessions
  for select to authenticated
  using (
    public.is_admin()
    or (
      consultant_id = auth.uid()
      and (
        status in ('requested', 'scheduled')
        or (
          status = 'declined'
          and cancelled_at > now() - interval '7 days'
        )
      )
    )
  );

comment on table public.coaching_sessions is
  'Private one-to-one coaching. A consultant sees only their own upcoming sessions, their own pending request, and a recently declined request - never cancelled sessions, never history, never anyone else. Never deleted.';
