-- ---------------------------------------------------------------------------
-- 0017 - A submitted day cannot go back to being a draft.
--
-- The daily form offered "Save draft" alongside "Resubmit" even after a day had
-- been submitted, and saving a draft set status back to 'draft'. Everything
-- downstream keys on status = 'submitted', so one misplaced tap:
--
--   * put the person back on the missing list and restarted the hourly chase,
--   * put their name in the 6 AM digest to admins,
--   * counted the day as missed in monthly compliance,
--
-- all while first_submitted_at sat in the row proving they had submitted on
-- time. The UI no longer offers the button, but the UI is not the boundary.
--
-- There is no legitimate reason to un-submit. A day with the wrong figures is
-- corrected by editing and resubmitting, which the trigger already handles and
-- audits. This is the same stance the schema takes on deleting a case: the way
-- to fix a mistake is to record the correction, not to erase the record.
-- ---------------------------------------------------------------------------

create or replace function public.handle_submission_timing()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'submitted' then
      new.first_submitted_at := now();
      new.last_submitted_at  := now();
    else
      new.first_submitted_at := null;
      new.last_submitted_at  := null;
    end if;
    new.revision_count := 0;
    return new;
  end if;

  -- A submitted day stays submitted.
  if old.status = 'submitted' and new.status <> 'submitted' then
    raise exception
      'A submitted day cannot be returned to draft. Edit the figures and resubmit instead.'
      using errcode = 'check_violation';
  end if;

  -- UPDATE. Start by discarding whatever the client sent for these three
  -- columns: they are ours, not theirs.
  new.first_submitted_at := old.first_submitted_at;
  new.last_submitted_at  := old.last_submitted_at;
  new.revision_count     := old.revision_count;

  if new.status = 'submitted' then
    if old.first_submitted_at is null then
      -- Draft becoming submitted, or a first submission. Not a revision.
      new.first_submitted_at := now();
      new.last_submitted_at  := now();
    else
      -- Already submitted - the only way to reach here now that un-submitting
      -- is refused. Only count it as a revision if the figures management
      -- actually reads have changed. An identical resubmit is a double click,
      -- and must not inflate the revision count or the time.
      if (new.dials, new.talked_to, new.campaign_status, new.in_office,
          coalesce(new.notes, ''))
         is distinct from
         (old.dials, old.talked_to, old.campaign_status, old.in_office,
          coalesce(old.notes, ''))
      then
        new.last_submitted_at := now();
        new.revision_count    := old.revision_count + 1;
      end if;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.handle_submission_timing() is
  'Owns first_submitted_at, last_submitted_at and revision_count, and refuses to un-submit a day.';
