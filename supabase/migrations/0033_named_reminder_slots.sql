-- ---------------------------------------------------------------------------
-- 0033 - Let a reminder slot be named, not just numbered.
--
-- The evening chase was hourly, so the hour was a sufficient name for a slot
-- and `push_<hour>` was a sufficient idempotency key. It is now five fixed
-- slots - 7, 9, 11 and 11:59 PM, plus a silent one at 6 AM - and two of those
-- fall in the same hour.
--
-- 11:00 PM and 11:59 PM are both hour 23. The 11:59 run therefore needs a key
-- of its own, or it keys on `push_23`, finds the 11 PM row already written,
-- and skips itself as a duplicate of the reminder it is meant to follow. It
-- is called with ?slot=deadline and writes `push_deadline`.
--
-- Which the existing check constraint rejects: `^push_[0-9]{1,2}$`.
--
-- That failure mode is worth spelling out, because it is worse than a crash.
-- The function sends the notification FIRST and writes the log row after, and
-- it does not inspect the result of the write. So the final call would have
-- gone out, the row would have been refused, and `alreadySent` would have
-- found nothing on the next run - meaning a retry would send it again, and
-- the morning report would show the slot as never having run.
--
-- The named form is spelled out rather than widened to `[a-z_]+`, so a typo in
-- a slot name is still caught here instead of quietly becoming a new slot.
-- ---------------------------------------------------------------------------

alter table public.reminder_logs
  drop constraint if exists reminder_logs_reminder_type_check;

alter table public.reminder_logs
  add constraint reminder_logs_reminder_type_check check (
    reminder_type in (
      'consultant_missing',
      'admin_digest',
      'admin_digest_push',
      -- The 11:59 PM final call. See above.
      'push_deadline'
    )
    or reminder_type ~ '^push_[0-9]{1,2}$'
  );

comment on column public.reminder_logs.reminder_type is
  'consultant_missing | admin_digest | admin_digest_push | push_<hour> | push_deadline. The suffix gives each slot its own idempotency key; push_deadline exists because 11 PM and 11:59 PM share hour 23.';
