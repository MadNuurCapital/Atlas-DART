/**
 * Domain vocabulary. These values are mirrored by CHECK constraints in the
 * database - if you add one here, add it to the migration too, or the write
 * will be rejected by Postgres (which is the point).
 */

export const ROLES = ["consultant", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const CAMPAIGN_STATUSES = ["running", "paused", "not_running"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  running: "Running",
  paused: "Paused",
  not_running: "Not running",
};

export const SUBMISSION_STATUSES = ["draft", "submitted"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const APPOINTMENT_TYPES = [
  "opening",
  "closing",
  "follow_up",
  "nomination",
] as const;
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

/** Short codes as used on the dashboard and in the Excel export. */
export const APPOINTMENT_TYPE_CODES: Record<AppointmentType, string> = {
  opening: "AO",
  closing: "AC",
  follow_up: "FU",
  nomination: "N",
};

export const APPOINTMENT_TYPE_LABELS: Record<AppointmentType, string> = {
  opening: "Appointment Opening",
  closing: "Appointment Closing",
  follow_up: "Follow-Up",
  nomination: "Nomination",
};

/**
 * Policy types, taken verbatim from the Case Tracker cross-tab in the existing
 * Consultant_XXX.numbers workbook, plus "Other" so an unmapped product has
 * somewhere to go (the workbook had nowhere).
 */
export const POLICY_TYPES = [
  "A&H",
  "CIS-Cash",
  "CIS-CPF",
  "CS",
  "GI",
  "ILP",
  "Term",
  "Other",
] as const;
export type PolicyType = (typeof POLICY_TYPES)[number];

export const CASE_STATUSES = ["active", "cancelled"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const REMINDER_TYPES = ["consultant_missing", "admin_digest"] as const;
export type ReminderType = (typeof REMINDER_TYPES)[number];

/** Actions written to audit_logs. */
export const AUDIT_ACTIONS = [
  "daily_submission_created",
  "daily_submission_resubmitted",
  "case_created",
  "case_updated",
  "case_cancelled",
  "case_restored",
  "target_changed",
  "insurer_created",
  "insurer_updated",
  "admin_override_submission",
  "user_invited",
  "user_role_changed",
  "user_deactivated",
  "user_reactivated",
  "coaching_created",
  "coaching_requested",
  "coaching_scheduled",
  "coaching_updated",
  "coaching_rescheduled",
  "coaching_cancelled",
  "coaching_declined",
  "coaching_completed",
  "coaching_reopened",
  "coaching_missed",
  "coaching_acknowledged",
] as const;

/** Plain-English descriptions for the audit trail screen. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  daily_submission_created: "Submitted a day",
  daily_submission_resubmitted: "Resubmitted a day",
  case_created: "Added a case",
  case_updated: "Edited a case",
  case_cancelled: "Cancelled a case",
  case_restored: "Restored a case",
  target_changed: "Changed a target",
  insurer_created: "Added an insurer",
  insurer_updated: "Changed an insurer",
  admin_override_submission: "Edited someone else's day",
  user_invited: "Invited someone",
  user_role_changed: "Changed a role",
  user_deactivated: "Deactivated an account",
  user_reactivated: "Reactivated an account",
  coaching_created: "Booked a coaching session",
  coaching_requested: "Requested coaching",
  coaching_scheduled: "Scheduled a requested session",
  coaching_updated: "Edited a coaching session",
  coaching_rescheduled: "Moved a coaching session",
  coaching_cancelled: "Cancelled a coaching session",
  coaching_declined: "Declined a coaching request",
  coaching_completed: "Completed a coaching session",
  coaching_reopened: "Reopened a coaching session",
  coaching_missed: "Marked coaching as missed",
  coaching_acknowledged: "Acknowledged a coaching session",
};
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Submission deadline, Singapore time. Displayed on the daily form. */
export const DEADLINE_LABEL = "11:59 PM";

/** Currency formatting for GR and APE. Singapore dollars throughout. */
export const CURRENCY_CODE = "SGD";

export function formatCurrency(value: number | null | undefined): string {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: CURRENCY_CODE,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/**
 * The most cases loaded onto a case list page at once.
 *
 * The list filters on the client so search and the month picker feel instant,
 * which means everything has to reach the browser. That is fine for a
 * consultant's own book and fine for a team's first couple of years, but it is
 * not fine forever - and an unbounded query that quietly gets slower every
 * month is the kind of thing nobody notices until it is painful.
 *
 * Newest first, so the cap drops the oldest cases rather than a random slice,
 * and the list says plainly when it has been reached. Dashboard totals and the
 * monthly export aggregate in Postgres and are not capped.
 */
export const CASE_PAGE_LIMIT = 1000;

/**
 * Coaching categories.
 *
 * The vocabulary the team already uses for reviews, plus one for coaching that
 * is not on a review cycle. Fixed values rather than free text, so counting
 * them later is possible - the same reason policy types are a check constraint
 * and insurers are not.
 */
export const COACHING_CATEGORIES = [
  "monthly_review",
  "mid_year_review",
  "yearly_review",
  "ad_hoc",
] as const;
export type CoachingCategory = (typeof COACHING_CATEGORIES)[number];

export const COACHING_CATEGORY_LABELS: Record<CoachingCategory, string> = {
  monthly_review: "Monthly Review",
  mid_year_review: "Mid-Year Review",
  yearly_review: "Yearly Review",
  ad_hoc: "Ad-hoc",
};

/**
 * Where a session is in its life.
 *
 * 'requested' is a consultant asking; it carries no time until an admin
 * schedules it. 'declined' is kept apart from 'cancelled' so that saying no to
 * a request does not read as calling off a booked meeting.
 */
export const COACHING_STATUSES = [
  "requested",
  "scheduled",
  "completed",
  "cancelled",
  "declined",
  "missed",
] as const;
export type CoachingStatus = (typeof COACHING_STATUSES)[number];

export const COACHING_STATUS_LABELS: Record<CoachingStatus, string> = {
  requested: "Requested",
  scheduled: "Scheduled",
  completed: "Completed",
  cancelled: "Cancelled",
  declined: "Declined",
  missed: "Missed",
};

/** Excel number formats. Kept here so the export and the UI cannot drift. */
export const EXCEL_CURRENCY_FORMAT = '"S$"#,##0.00';
export const EXCEL_PERCENT_FORMAT = "0.0%";
export const EXCEL_DATE_FORMAT = "dd/mm/yyyy";
