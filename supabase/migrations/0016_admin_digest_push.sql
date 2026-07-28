-- ---------------------------------------------------------------------------
-- 0016 - Allow the admin digest to be logged as a push as well as an email.
--
-- The 6 AM list to admins was email only, which meant it could not be sent at
-- all until a sending domain existed. It now goes out as a notification too,
-- and the two need separate log rows: they can succeed and fail independently,
-- and collapsing them into one row would let a working notification be
-- recorded as a failure because Resend was not configured.
-- ---------------------------------------------------------------------------

alter table public.reminder_logs
  drop constraint if exists reminder_logs_reminder_type_check;

alter table public.reminder_logs
  add constraint reminder_logs_reminder_type_check check (
    reminder_type in (
      'consultant_missing',
      'admin_digest',
      'admin_digest_push'
    )
    or reminder_type ~ '^push_[0-9]{1,2}$'
  );

comment on column public.reminder_logs.reminder_type is
  'consultant_missing | admin_digest | admin_digest_push | push_<hour>. The hour suffix gives each nag its own idempotency key.';
