-- ===========================================================================
-- Atlas DART - which cases were announced, and which were not
-- ===========================================================================
--
-- READ-ONLY. Paste into the Supabase SQL editor and run.
--
-- The first diagnostic reported "9 cases saved with no event" as a failure.
-- That verdict was too blunt: a case submitted BEFORE the announcing trigger
-- existed has no event and never could have, and that is not a fault. The
-- trigger was added in migration 0026, days after the app had been recording
-- cases normally.
--
-- So this lists the cases in order and marks the point the trigger started
-- working. A clean split - everything before the line unannounced, everything
-- after it announced - means nothing is broken. Announced and unannounced
-- INTERLEAVED after that point means the trigger really is failing sometimes,
-- which is a different problem and a real one.
-- ===========================================================================

with first_event as (
  select min(created_at) as started from public.team_events
),

recent as (
  select
    c.id,
    c.created_at,
    c.consultant_id,
    (e.id is not null) as announced
  from public.cases c
  left join public.team_events e on e.case_id = c.id
  where c.created_at > now() - interval '7 days'
)

select
  to_char(r.created_at at time zone 'Asia/Singapore',
          'DD Mon HH24:MI')                       as submitted_sgt,
  coalesce(p.full_name, '(unknown)')              as advisor,
  case when r.announced then 'yes' else 'NO' end  as announced,
  case
    when r.announced
      then 'fine'
    when f.started is null
      then 'no events exist at all - see the main diagnostic'
    when r.created_at < f.started
      then 'expected - submitted before the trigger was installed'
    else 'UNEXPECTED - submitted after the trigger started working'
  end                                             as reading
from recent r
cross join first_event f
left join public.profiles p on p.id = r.consultant_id
order by r.created_at desc;
