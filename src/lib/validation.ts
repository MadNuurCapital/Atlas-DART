import { z } from "zod";
import {
  APPOINTMENT_TYPES,
  CAMPAIGN_STATUSES,
  POLICY_TYPES,
} from "@/lib/constants";
import { EDIT_WINDOW_DAYS, isWithinEditWindow, sgToday } from "@/lib/sg-date";

/**
 * Shared validation.
 *
 * These schemas run on the client for immediate feedback AND on the server
 * before any write. The server run is the one that counts - the client is a
 * courtesy, and a request can always be forged.
 *
 * Every rule here has a matching constraint in the database, so a bug in this
 * file degrades the error message, not the data.
 */

export const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date");

/** A date a consultant is still allowed to write to (decision D2). */
export const editableBusinessDateSchema = businessDateSchema.refine(
  (value) => isWithinEditWindow(value, sgToday()),
  {
    message: `You can only edit the last ${EDIT_WINDOW_DAYS} days. Ask an admin for anything older.`,
  },
);

/** Counts are whole, non-negative, and zero is a perfectly valid day. */
const countSchema = z
  .number({ message: "Enter a number" })
  .int("Whole numbers only")
  .min(0, "Cannot be negative")
  .max(9999, "That looks like a typo");

export const dailySubmissionSchema = z.object({
  businessDate: editableBusinessDateSchema,
  dials: countSchema,
  talkedTo: countSchema,
  campaignStatus: z.enum(CAMPAIGN_STATUSES, {
    message: "Choose a campaign status",
  }),
  inOffice: z.boolean({ message: "Say whether you were in the office" }),
  notes: z
    .string()
    .max(2000, "Keep notes under 2000 characters")
    .optional()
    .or(z.literal("")),
});

export type DailySubmissionInput = z.infer<typeof dailySubmissionSchema>;

export const appointmentSchema = z.object({
  businessDate: editableBusinessDateSchema,
  prospectName: z
    .string()
    .trim()
    .min(1, "Enter the prospect's name")
    .max(120, "That name is too long"),
  appointmentType: z.enum(APPOINTMENT_TYPES, {
    message: "Choose an appointment type",
  }),
  note: z.string().trim().max(500, "Keep the note under 500 characters").optional().or(z.literal("")),
});

export type AppointmentInput = z.infer<typeof appointmentSchema>;

const moneySchema = z
  .number({ message: "Enter an amount" })
  .min(0, "Cannot be negative")
  .max(99_999_999, "That looks like a typo")
  // At most two decimal places, matching numeric(12,2) in the database.
  // Compared with a tolerance because 10.55 * 100 is 1055.0000000000002 in
  // binary floating point, and an exact equality check would reject it.
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, {
    message: "Use at most two decimal places",
  });

export const caseSchema = z
  .object({
    dateSubmitted: businessDateSchema,
    dateIncepted: businessDateSchema.optional().or(z.literal("")),
    clientName: z.string().trim().min(1, "Enter the client's name").max(120),
    insurerId: z.string().uuid("Choose an insurer"),
    policyName: z.string().trim().min(1, "Enter the policy name").max(160),
    policyType: z.enum(POLICY_TYPES, { message: "Choose a policy type" }),
    apeAmount: moneySchema,
    grAmount: moneySchema,
  })
  .refine(
    (v) => !v.dateIncepted || v.dateIncepted >= v.dateSubmitted,
    {
      message: "A policy cannot incept before it was submitted",
      path: ["dateIncepted"],
    },
  );

export type CaseInput = z.infer<typeof caseSchema>;

/** Cancelling requires a reason - the database enforces this too. */
export const cancelCaseSchema = z.object({
  caseId: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(3, "Give a reason so this can be understood later")
    .max(500, "Keep the reason under 500 characters"),
});

export const insurerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Enter the insurer's name")
    .max(120, "That name is too long"),
});

export const inviteUserSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Enter their full name")
    .max(120, "That name is too long"),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Enter their email")
    .email("That does not look like an email address"),
  role: z.enum(["consultant", "admin"], { message: "Choose a role" }),
});

export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const targetSchema = z.object({
  consultantId: z.string().uuid(),
  year: z.number().int().min(2000).max(2200),
  /** Null for the yearly row. */
  month: z.number().int().min(1).max(12).nullable(),
  grTarget: moneySchema,
});

/**
 * Turn a Zod error into the flat shape the form components expect.
 * One message per field - the first is the useful one.
 */
export function fieldErrors<T>(
  error: z.ZodError<T>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}
