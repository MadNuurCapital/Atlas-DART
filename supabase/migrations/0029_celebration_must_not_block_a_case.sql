-- ===========================================================================
-- 0029_celebration_must_not_block_a_case.sql
--
-- A case stopped saving. This is the fix, and the reason it could happen.
-- ===========================================================================
--
-- WHAT WENT WRONG
--
-- 0026 added an AFTER INSERT trigger on `cases` that writes a row to
-- team_events so colleagues can be told. An AFTER INSERT trigger runs inside
-- the same transaction as the insert that fired it, so when the trigger
-- raised, the case was rolled back with it. Submitting a case stopped working
-- and the advisor was told only "That case could not be saved."
--
-- Two separate mistakes, fixed separately below, because either one alone
-- would still have been wrong.
--
--
-- MISTAKE ONE - a nice-to-have was able to veto the core workflow
--
-- Recording a case is the thing this application exists to do. Telling the
-- team about it is a courtesy. No courtesy should ever be able to prevent the
-- thing it is a courtesy about, whatever goes wrong inside it - a missing
-- table, a changed policy, a full disk.
--
-- The trigger body is now wrapped in an exception handler. A failure is
-- raised as a WARNING, which lands in the Postgres log where it can be found,
-- and the case is saved regardless. A celebration nobody receives costs
-- nothing. A case that does not save is somebody's commission.
--
--
-- MISTAKE TWO - FORCE ROW LEVEL SECURITY bound the only legitimate writer
--
-- team_events was created with `force row level security`, copying the
-- convention used across this schema, where it is right: it makes the table
-- owner obey its own policies, so a mistake at owner level cannot quietly read
-- or write past them.
--
-- But team_events has no insert policy for anybody, deliberately - the only
-- thing that may write to it is the SECURITY DEFINER trigger, which runs as
-- the table's owner. FORCE binds exactly that path. The table was configured
-- so that its one intended writer was the one role guaranteed to be refused.
--
-- It did not fail locally, which is the part worth remembering: the test
-- harness grants BYPASSRLS to the role that owns the schema (see
-- scripts/test-db.sh), and BYPASSRLS defeats FORCE. So the trigger ran as a
-- role that could ignore the policy, every test passed, and the first database
-- whose owner lacked that attribute was production.
--
-- FORCE is removed from these two tables only. RLS itself stays ENABLED, so
-- nothing changes for `authenticated`: there is still no insert, update or
-- delete policy for them, and still no matching grant. Both gates that face a
-- client are untouched. What is removed is a third gate that faced inwards and
-- blocked the server.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Let the server write to the tables only the server writes to
-- ---------------------------------------------------------------------------

alter table public.team_events   no force row level security;
alter table public.notifications no force row level security;

-- Stated again rather than assumed, so this file can be read on its own.
-- RLS remains ON for every non-owner role.
alter table public.team_events   enable row level security;
alter table public.notifications enable row level security;


-- ---------------------------------------------------------------------------
-- 2. Make the celebration incapable of blocking the case
-- ---------------------------------------------------------------------------

create or replace function public.on_case_created()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- A case created already-cancelled is not a thing to celebrate.
  if new.status is distinct from 'active' then
    return new;
  end if;

  begin
    insert into public.team_events (kind, actor_id, actor_name, case_id)
    select 'case_submitted', new.consultant_id, p.full_name, new.id
    from public.profiles p
    where p.id = new.consultant_id
    on conflict (case_id) do nothing;

  exception when others then
    -- Deliberately swallowed, and deliberately loud about it.
    --
    -- WARNING rather than EXCEPTION: an exception here would roll back the
    -- case, which is the bug this file exists to fix. The message carries the
    -- case id, SQLERRM and SQLSTATE so the cause is recoverable from the
    -- Postgres log rather than guessed at.
    raise warning
      '[on_case_created] case % saved, but the team was not told: % (%)',
      new.id, sqlerrm, sqlstate;
  end;

  return new;
end;
$$;

comment on function public.on_case_created() is
  'Announces a new case to the team. Cannot fail the insert that fired it: any error is logged as a warning and the case is saved regardless.';
