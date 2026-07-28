-- ---------------------------------------------------------------------------
-- 0015 - Allow push reminder types.
--
-- reminder_logs was written for two email reminders. The nagging push runs
-- hourly through the evening, and each hour needs its own log row so the
-- unique key still makes a retry idempotent - otherwise a Netlify retry at
-- 19:00 would be blocked by the row written at 18:00, or worse, would send a
-- second notification.
--
-- Hence reminder_type values like 'push_19'. The check is widened to allow
-- that shape rather than enumerating every hour.
-- ---------------------------------------------------------------------------

alter table public.reminder_logs
  drop constraint if exists reminder_logs_reminder_type_check;

alter table public.reminder_logs
  add constraint reminder_logs_reminder_type_check check (
    reminder_type in ('consultant_missing', 'admin_digest')
    or reminder_type ~ '^push_[0-9]{1,2}$'
  );

comment on column public.reminder_logs.reminder_type is
  'consultant_missing | admin_digest | push_<hour>. The hour suffix gives each nag its own idempotency key.';
