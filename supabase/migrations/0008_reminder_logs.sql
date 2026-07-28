-- ---------------------------------------------------------------------------
-- 0008 - reminder_logs
--
-- The unique constraint is the whole point: Netlify may retry a scheduled
-- function, and the reminder writes are upserts onto this key, so a retry can
-- never send a second email to the same person for the same day.
-- ---------------------------------------------------------------------------

create table if not exists public.reminder_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid        not null references public.profiles (id) on delete cascade,
  business_date date        not null,
  reminder_type text        not null
                  check (reminder_type in ('consultant_missing', 'admin_digest')),
  status        text        not null check (status in ('sent', 'failed')),
  error_message text,
  sent_at       timestamptz not null default now(),

  constraint reminder_logs_unique unique (user_id, business_date, reminder_type),

  -- A failure must say why. Silent failures are how reminder systems rot.
  constraint reminder_logs_failure_has_reason check (
    status = 'sent' or length(btrim(coalesce(error_message, ''))) > 0
  )
);

create index if not exists reminder_logs_date_idx
  on public.reminder_logs (business_date desc);

comment on table public.reminder_logs is
  'One row per person per day per reminder type. Unique key makes scheduled-function retries idempotent.';
