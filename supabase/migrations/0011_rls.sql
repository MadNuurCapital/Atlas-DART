-- ---------------------------------------------------------------------------
-- 0011 - Row Level Security.
--
-- This file is the security boundary. Middleware and server-side role checks
-- are convenience; if they were all removed, these policies would still stop a
-- consultant reading another consultant's book.
--
-- `force row level security` is used rather than plain `enable`, so the policies
-- bind the table owner too. Only the service-role connection - which has no
-- user session and is never reachable from the browser - bypasses them.
-- ---------------------------------------------------------------------------

alter table public.profiles               enable row level security;
alter table public.consultant_targets     enable row level security;
alter table public.daily_submissions      enable row level security;
alter table public.appointment_activities enable row level security;
alter table public.insurers               enable row level security;
alter table public.cases                  enable row level security;
alter table public.reminder_logs          enable row level security;
alter table public.audit_logs             enable row level security;

alter table public.profiles               force row level security;
alter table public.consultant_targets     force row level security;
alter table public.daily_submissions      force row level security;
alter table public.appointment_activities force row level security;
alter table public.insurers               force row level security;
alter table public.cases                  force row level security;
alter table public.reminder_logs          force row level security;
alter table public.audit_logs             force row level security;

-- The anon role gets nothing anywhere. Sign in first.
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- profiles
-- Column-level protection (role, active) is handled by guard_profile_columns
-- in 0002 - RLS grants whole rows and cannot express "not this column".
-- ---------------------------------------------------------------------------
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

create policy profiles_insert_admin on public.profiles
  for insert to authenticated
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- consultant_targets
-- Decision D8: only admins write targets, including their own. Consultants can
-- see their number but cannot touch it. The audit trail is what keeps a
-- self-editing admin accountable.
-- ---------------------------------------------------------------------------
create policy targets_select on public.consultant_targets
  for select to authenticated
  using (consultant_id = auth.uid() or public.is_admin());

create policy targets_insert_admin on public.consultant_targets
  for insert to authenticated
  with check (public.is_admin());

create policy targets_update_admin on public.consultant_targets
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy targets_delete_admin on public.consultant_targets
  for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- daily_submissions
-- Decision D2: a consultant may write only their own rows, and only inside the
-- 7-day window. Admins are unrestricted; their overrides are audit-logged by
-- the application.
-- ---------------------------------------------------------------------------
create policy submissions_select on public.daily_submissions
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy submissions_insert_own on public.daily_submissions
  for insert to authenticated
  with check (
    public.is_admin()
    or (user_id = auth.uid() and public.within_edit_window(business_date))
  );

create policy submissions_update_own on public.daily_submissions
  for update to authenticated
  using (
    public.is_admin()
    or (user_id = auth.uid() and public.within_edit_window(business_date))
  )
  with check (
    public.is_admin()
    or (user_id = auth.uid() and public.within_edit_window(business_date))
  );

-- No delete policy. A day that was submitted stays submitted.

-- ---------------------------------------------------------------------------
-- appointment_activities
-- user_id and business_date are rewritten from the parent submission by
-- enforce_appointment_parent (0005) BEFORE these checks run, so attaching an
-- appointment to somebody else's submission fails the WITH CHECK below.
-- ---------------------------------------------------------------------------
create policy appointments_select on public.appointment_activities
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy appointments_insert_own on public.appointment_activities
  for insert to authenticated
  with check (
    public.is_admin()
    or (user_id = auth.uid() and public.within_edit_window(business_date))
  );

create policy appointments_update_own on public.appointment_activities
  for update to authenticated
  using (
    public.is_admin()
    or (user_id = auth.uid() and public.within_edit_window(business_date))
  )
  with check (
    public.is_admin()
    or (user_id = auth.uid() and public.within_edit_window(business_date))
  );

-- Appointments are the one thing a consultant may genuinely remove: deleting a
-- mistyped appointment must adjust the AO/AC/FU/N counts, and there is no
-- reporting history to protect at the individual appointment level.
create policy appointments_delete_own on public.appointment_activities
  for delete to authenticated
  using (
    public.is_admin()
    or (user_id = auth.uid() and public.within_edit_window(business_date))
  );

-- ---------------------------------------------------------------------------
-- insurers
-- Decision D19: consultants add their own. The unique index on lower(name) in
-- 0006 is what stops that fragmenting the reporting.
-- Retiring or renaming an insurer stays with admins.
-- ---------------------------------------------------------------------------
create policy insurers_select on public.insurers
  for select to authenticated
  using (true);

create policy insurers_insert on public.insurers
  for insert to authenticated
  with check (auth.uid() is not null);

create policy insurers_update_admin on public.insurers
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- cases
--
-- Note what is absent: there is NO delete policy, for any role. Decision D15
-- says a case is never destroyed, and that rule lives here rather than in the
-- user interface, so it holds even if every screen were bypassed.
--
-- Consultants also cannot restore: the update policy forbids moving a case
-- from cancelled back to active. Restoration is an admin action (D15).
-- ---------------------------------------------------------------------------
create policy cases_select on public.cases
  for select to authenticated
  using (consultant_id = auth.uid() or public.is_admin());

create policy cases_insert_own on public.cases
  for insert to authenticated
  with check (public.is_admin() or consultant_id = auth.uid());

-- A policy sees only the row being written, so "was it cancelled before?" is
-- not a question it can answer. The cancelled -> active transition is blocked
-- by guard_case_restore() in 0007 instead, which can see OLD and NEW.
create policy cases_update_own on public.cases
  for update to authenticated
  using (public.is_admin() or consultant_id = auth.uid())
  with check (public.is_admin() or consultant_id = auth.uid());

-- ---------------------------------------------------------------------------
-- reminder_logs - readable so a consultant can see they were chased, and so an
-- admin can audit the mailer. Written only by the scheduled functions, which
-- use the service role and bypass RLS.
-- ---------------------------------------------------------------------------
create policy reminder_logs_select on public.reminder_logs
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- audit_logs - append only. There is deliberately no UPDATE or DELETE policy
-- for anyone, including admins.
-- ---------------------------------------------------------------------------
create policy audit_logs_select_admin on public.audit_logs
  for select to authenticated
  using (public.is_admin() or actor_user_id = auth.uid());

create policy audit_logs_insert on public.audit_logs
  for insert to authenticated
  with check (actor_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Grants. RLS filters rows; grants decide whether the role may attempt the
-- statement at all. Both are needed.
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;

grant select, insert, update on public.profiles               to authenticated;
grant select, insert, update, delete on public.consultant_targets to authenticated;
grant select, insert, update on public.daily_submissions      to authenticated;
grant select, insert, update, delete on public.appointment_activities to authenticated;
grant select, insert, update on public.insurers               to authenticated;
grant select, insert, update on public.cases                  to authenticated;
grant select on public.reminder_logs                          to authenticated;
grant select, insert on public.audit_logs                     to authenticated;

grant select on public.v_daily_consultant_summary to authenticated;
grant select on public.v_monthly_consultant_gr    to authenticated;
grant select on public.v_yearly_consultant_gr     to authenticated;
grant select on public.v_case_totals              to authenticated;
grant select on public.v_case_mix_by_category     to authenticated;
grant select on public.v_pending_inception        to authenticated;
grant select on public.v_target_shortfall         to authenticated;
grant select on public.v_missing_submissions      to authenticated;

grant execute on function public.sg_today()                    to authenticated;
grant execute on function public.sg_deadline(date)             to authenticated;
grant execute on function public.is_admin()                    to authenticated;
grant execute on function public.within_edit_window(date)      to authenticated;
grant execute on function public.edit_window_days()            to authenticated;
grant execute on function public.missing_submissions(date)     to authenticated;
grant execute on function public.team_daily(date)              to authenticated;
grant execute on function public.monthly_compliance(int, int)  to authenticated;

-- DELETE is never granted on cases or daily_submissions, to anyone.
