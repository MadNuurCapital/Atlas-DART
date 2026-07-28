-- ---------------------------------------------------------------------------
-- 0009 - audit_logs
--
-- Append-only. 0011_rls.sql grants INSERT but never UPDATE or DELETE to anyone,
-- including admins - an audit trail that can be edited is not an audit trail.
--
-- This is what makes "admins may edit their own target" acceptable (D8): the
-- change is permitted, but it is permanently attributable.
-- ---------------------------------------------------------------------------

create table if not exists public.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  actor_user_id uuid        references public.profiles (id) on delete set null,
  action        text        not null check (length(btrim(action)) > 0),
  entity_type   text        not null check (length(btrim(entity_type)) > 0),
  entity_id     uuid,
  old_values    jsonb,
  new_values    jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists audit_logs_entity_idx
  on public.audit_logs (entity_type, entity_id, created_at desc);

create index if not exists audit_logs_actor_idx
  on public.audit_logs (actor_user_id, created_at desc);

create index if not exists audit_logs_created_idx
  on public.audit_logs (created_at desc);

comment on table public.audit_logs is
  'Append-only trail. No UPDATE or DELETE policy exists for any role, including admin.';
