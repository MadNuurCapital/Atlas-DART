/**
 * Database types.
 *
 * Hand-maintained to match supabase/migrations. Once a Supabase project exists,
 * regenerate with:
 *
 *   npx supabase gen types typescript --project-id <ref> > src/types/database.ts
 *
 * and this file becomes generated rather than authored. Until then it is the
 * contract that keeps the client honest about column names and nullability.
 */

import type {
  AppointmentType,
  CampaignStatus,
  CaseStatus,
  CoachingCategory,
  CoachingStatus,
  PolicyType,
  ReminderType,
  Role,
  SubmissionStatus,
} from "@/lib/constants";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type Timestamps = {
  created_at: string;
  updated_at: string;
};

export type Profile = Timestamps & {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  active: boolean;
};

export type ConsultantTarget = Timestamps & {
  id: string;
  consultant_id: string;
  period_type: "monthly" | "yearly";
  year: number;
  /** Null for a yearly row. */
  month: number | null;
  gr_target: number;
};

export type DailySubmission = Timestamps & {
  id: string;
  user_id: string;
  business_date: string;
  dials: number;
  talked_to: number;
  campaign_status: CampaignStatus;
  in_office: boolean;
  notes: string | null;
  status: SubmissionStatus;
  /** Trigger-owned. Never send this from the client; it will be ignored. */
  first_submitted_at: string | null;
  /** Trigger-owned. */
  last_submitted_at: string | null;
  /** Trigger-owned. */
  revision_count: number;
};

export type AppointmentActivity = Timestamps & {
  id: string;
  daily_submission_id: string;
  /** Derived from the parent submission by a trigger. */
  user_id: string;
  /** Derived from the parent submission by a trigger. */
  business_date: string;
  prospect_name: string;
  appointment_type: AppointmentType;
  note: string | null;
};

export type Insurer = Timestamps & {
  id: string;
  name: string;
  active: boolean;
  created_by: string | null;
};

export type Case = Timestamps & {
  id: string;
  consultant_id: string;
  /** Drives GR and the reporting month (decision D16). */
  date_submitted: string;
  /** Optional. Null means Pending Inception; it does not affect GR. */
  date_incepted: string | null;
  client_name: string;
  insurer_id: string;
  policy_name: string;
  policy_type: PolicyType;
  ape_amount: number;
  gr_amount: number;
  status: CaseStatus;
  cancellation_reason: string | null;
  cancelled_at: string | null;
};

export type PushSubscription = {
  id: string;
  user_id: string;
  /** The browser's push service URL. Unique per installation. */
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  failure_count: number;
  created_at: string;
  last_used_at: string | null;
};

/**
 * A private coaching session.
 *
 * Internal and outcome notes are deliberately NOT on this type: they live in
 * coaching_notes, which a consultant has no policy on at all. Row Level
 * Security grants whole rows, so a note kept here would be readable by the
 * person it is about.
 */
export type CoachingSession = Timestamps & {
  id: string;
  /** The person being coached. */
  consultant_id: string;
  /** The admin running it. Null on a request nobody has picked up yet. */
  coach_id: string | null;
  created_by: string;
  title: string;
  category: CoachingCategory;
  message: string | null;
  location: string | null;
  /** What the consultant asked to be coached on. */
  requested_topic: string | null;
  /** What the admin plans to cover. Both are visible to both. */
  agenda: string | null;
  /** Null while the status is 'requested'. */
  scheduled_at: string | null;
  status: CoachingStatus;
  acknowledged_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
};

/** Admin-only. Never sent to the consultant the notes are about. */
export type CoachingNotes = Timestamps & {
  session_id: string;
  internal_notes: string | null;
  outcome_notes: string | null;
};

export type CoachingReminderKind =
  | "assigned"
  | "day_before"
  | "morning_of"
  | "rescheduled"
  | "cancelled";

export type CoachingReminderSent = {
  id: string;
  session_id: string;
  kind: CoachingReminderKind;
  status: "sent" | "failed";
  error_message: string | null;
  sent_at: string;
};

export type ReminderLog = {
  id: string;
  user_id: string;
  business_date: string;
  reminder_type: ReminderType;
  status: "sent" | "failed";
  error_message: string | null;
  sent_at: string;
};

export type AuditLog = {
  id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_values: Json | null;
  new_values: Json | null;
  created_at: string;
};

export type DailyConsultantSummary = {
  submission_id: string;
  user_id: string;
  full_name: string;
  role: Role;
  business_date: string;
  dials: number;
  talked_to: number;
  campaign_status: CampaignStatus;
  in_office: boolean;
  notes: string | null;
  status: SubmissionStatus;
  first_submitted_at: string | null;
  last_submitted_at: string | null;
  revision_count: number;
  appointments_opening: number;
  appointments_closing: number;
  appointments_follow_up: number;
  appointments_nomination: number;
  appointments_total: number;
  signed_cases: number;
  active_gr: number;
  active_ape: number;
  on_time: boolean;
};

export type TargetShortfall = {
  consultant_id: string;
  full_name: string;
  as_of: string;
  year: number;
  month: number;
  month_to_date_gr: number;
  year_to_date_gr: number;
  month_active_cases: number;
  year_active_cases: number;
  /** Null means no target set - render that, never a zero. */
  monthly_target: number | null;
  yearly_target: number | null;
  monthly_shortfall: number | null;
  yearly_shortfall: number | null;
  monthly_achievement: number | null;
  yearly_achievement: number | null;
};

export type CaseMixByCategory = {
  consultant_id: string;
  year: number;
  month: number;
  policy_type: PolicyType;
  case_count: number;
  ape: number;
  gr: number;
};

export type PendingInception = {
  consultant_id: string;
  pending_cases: number;
  pending_gr: number;
  pending_ape: number;
  oldest_submitted: string | null;
};

export type MissingSubmission = {
  user_id: string;
  full_name: string;
  email: string;
  role: Role;
  business_date: string;
};

/**
 * One row per active person for a given date, whether or not they submitted.
 * A missing person is a row with nulls and status "missing", never an absence.
 */
export type TeamDailyRow = {
  user_id: string;
  full_name: string;
  role: Role;
  business_date: string;
  submission_id: string | null;
  status: SubmissionStatus | "missing";
  dials: number | null;
  talked_to: number | null;
  campaign_status: CampaignStatus | null;
  in_office: boolean | null;
  appointments_opening: number | null;
  appointments_closing: number | null;
  appointments_follow_up: number | null;
  appointments_nomination: number | null;
  signed_cases: number | null;
  active_gr: number | null;
  first_submitted_at: string | null;
  last_submitted_at: string | null;
  revision_count: number | null;
  on_time: boolean | null;
};

export type MonthlyComplianceRow = {
  consultant_id: string;
  full_name: string;
  required_days: number;
  submitted_days: number;
  on_time_days: number;
  late_days: number;
  missing_days: number;
  compliance: number;
};

type InsertOf<T, Generated extends keyof T> = Omit<T, Generated> &
  Partial<Pick<T, Generated>>;

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: InsertOf<Profile, "created_at" | "updated_at" | "role" | "active">;
        Update: Partial<Profile>;
        Relationships: [];
      };
      consultant_targets: {
        Row: ConsultantTarget;
        Insert: InsertOf<ConsultantTarget, "id" | "created_at" | "updated_at" | "month">;
        Update: Partial<ConsultantTarget>;
        Relationships: [];
      };
      daily_submissions: {
        Row: DailySubmission;
        Insert: InsertOf<
          DailySubmission,
          | "id"
          | "created_at"
          | "updated_at"
          | "first_submitted_at"
          | "last_submitted_at"
          | "revision_count"
          | "notes"
          | "status"
        >;
        Update: Partial<DailySubmission>;
        Relationships: [];
      };
      appointment_activities: {
        Row: AppointmentActivity;
        Insert: InsertOf<AppointmentActivity, "id" | "created_at" | "updated_at" | "note">;
        Update: Partial<AppointmentActivity>;
        Relationships: [];
      };
      insurers: {
        Row: Insurer;
        Insert: InsertOf<Insurer, "id" | "created_at" | "updated_at" | "active" | "created_by">;
        Update: Partial<Insurer>;
        Relationships: [];
      };
      cases: {
        Row: Case;
        Insert: InsertOf<
          Case,
          | "id"
          | "created_at"
          | "updated_at"
          | "status"
          | "date_incepted"
          | "cancellation_reason"
          | "cancelled_at"
        >;
        Update: Partial<Case>;
        Relationships: [];
      };
      coaching_sessions: {
        Row: CoachingSession;
        Insert: InsertOf<
          CoachingSession,
          | "id"
          | "created_at"
          | "updated_at"
          | "coach_id"
          | "message"
          | "location"
          | "requested_topic"
          | "agenda"
          | "scheduled_at"
          | "status"
          | "acknowledged_at"
          | "completed_at"
          | "cancelled_at"
          | "cancellation_reason"
        >;
        Update: Partial<CoachingSession>;
        Relationships: [];
      };
      coaching_notes: {
        Row: CoachingNotes;
        Insert: InsertOf<
          CoachingNotes,
          "created_at" | "updated_at" | "internal_notes" | "outcome_notes"
        >;
        Update: Partial<CoachingNotes>;
        Relationships: [];
      };
      coaching_reminders_sent: {
        Row: CoachingReminderSent;
        Insert: InsertOf<CoachingReminderSent, "id" | "sent_at" | "error_message">;
        Update: Partial<CoachingReminderSent>;
        Relationships: [];
      };
      push_subscriptions: {
        Row: PushSubscription;
        Insert: InsertOf<
          PushSubscription,
          | "id"
          | "created_at"
          | "last_used_at"
          | "failure_count"
          | "user_agent"
        >;
        Update: Partial<PushSubscription>;
        Relationships: [];
      };
      reminder_logs: {
        Row: ReminderLog;
        Insert: InsertOf<ReminderLog, "id" | "sent_at" | "error_message">;
        Update: Partial<ReminderLog>;
        Relationships: [];
      };
      audit_logs: {
        Row: AuditLog;
        Insert: InsertOf<AuditLog, "id" | "created_at" | "entity_id" | "old_values" | "new_values">;
        // Append-only in practice. That is enforced by RLS - there is no UPDATE
        // or DELETE policy on this table - not by the shape of this type.
        Update: never;
        Relationships: [];
      };
    };
    // Read-only views. `Relationships` is required for the schema to satisfy
    // postgrest-js's GenericSchema; without it the typed client silently
    // degrades every `.from()` call to `never`.
    Views: {
      v_daily_consultant_summary: {
        Row: DailyConsultantSummary;
        Relationships: [];
      };
      v_target_shortfall: { Row: TargetShortfall; Relationships: [] };
      v_case_mix_by_category: { Row: CaseMixByCategory; Relationships: [] };
      v_pending_inception: { Row: PendingInception; Relationships: [] };
      v_missing_submissions: { Row: MissingSubmission; Relationships: [] };
    };
    Functions: {
      sg_today: { Args: Record<string, never>; Returns: string };
      is_admin: { Args: Record<string, never>; Returns: boolean };
      missing_submissions: {
        Args: { p_date?: string };
        Returns: MissingSubmission[];
      };
      team_daily: { Args: { p_date?: string }; Returns: TeamDailyRow[] };
      monthly_compliance: {
        Args: { p_year: number; p_month: number };
        Returns: MonthlyComplianceRow[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
