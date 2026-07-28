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
] as const;
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

/** Excel number formats. Kept here so the export and the UI cannot drift. */
export const EXCEL_CURRENCY_FORMAT = '"S$"#,##0.00';
export const EXCEL_PERCENT_FORMAT = "0.0%";
export const EXCEL_DATE_FORMAT = "dd/mm/yyyy";
