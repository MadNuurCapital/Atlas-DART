-- ---------------------------------------------------------------------------
-- 0022 - An acknowledgement survives the session being completed.
--
-- 0018 said acknowledged_at could only be set while the status was
-- 'scheduled'. The intent was to stop a request or a cancelled session being
-- acknowledged, which is meaningless. The effect was worse than that: once a
-- consultant tapped "Got it", the session could never be marked completed or
-- missed at all, because the update carried the acknowledgement forward into a
-- status the constraint forbade.
--
-- So Complete failed with a constraint violation, and only for sessions the
-- consultant had actually confirmed - which is to say, the ones most likely to
-- have gone ahead.
--
-- The acknowledgement is a historical fact: they confirmed it, and completing
-- the session does not un-confirm it. The Excel export has an Acknowledged
-- column that would read wrong if it were cleared. So the constraint now
-- allows it to persist into the states a scheduled session can reach.
--
-- 'requested' and 'declined' still cannot carry one - there is nothing to
-- acknowledge. 'cancelled' still cannot either, and the cancel action clears
-- it deliberately: confirming a meeting that was then called off is not an
-- acknowledgement of anything.
-- ---------------------------------------------------------------------------

alter table public.coaching_sessions
  drop constraint if exists coaching_acknowledged_only_when_scheduled;

alter table public.coaching_sessions
  add constraint coaching_acknowledged_only_when_scheduled check (
    acknowledged_at is null
    or status in ('scheduled', 'completed', 'missed')
  );
