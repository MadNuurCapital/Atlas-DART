import { z } from "zod";
import {
  APPOINTMENT_TYPES,
  CAMPAIGN_STATUSES,
  COACHING_CATEGORIES,
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

/**
 * The same comparison the unique index on `insurers` makes: `lower(btrim(name))`.
 *
 * Kept deliberately identical to the database. When an inline add collides
 * with an existing insurer we look the existing one up with ilike - which
 * treats %, _ and * as wildcards - so the match has to be confirmed before its
 * id is handed back. Filing a case under the wrong insurer is a great deal
 * worse than asking someone to retype a name.
 */
export function sameInsurerName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

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

/**
 * A coaching session an admin is booking.
 *
 * scheduledAt arrives as the two halves a phone actually offers - a date input
 * and a time input - and is turned into an instant by the action, which is the
 * only place that knows Singapore is UTC+8. Validating the halves separately
 * gives a usable error on the field the person got wrong.
 */
export const coachingSessionSchema = z.object({
  consultantId: z.string().uuid({ message: "Choose who this is for" }),
  coachId: z.string().uuid().nullable().optional(),
  title: z
    .string()
    .trim()
    .min(2, "Give the session a title")
    .max(200, "That title is too long"),
  category: z.enum(COACHING_CATEGORIES, { message: "Choose a category" }),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"),
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Choose a time"),
  location: z.string().trim().max(200).optional(),
  message: z.string().trim().max(1000).optional(),
  agenda: z.string().trim().max(4000).optional(),
});

export type CoachingSessionInput = z.infer<typeof coachingSessionSchema>;

/**
 * One line of a bulk booking: who, and at what time on the shared date.
 *
 * Twenty monthly reviews is twenty of these against one date and category.
 */
export const coachingSlotSchema = z.object({
  consultantId: z.string().uuid({ message: "Choose who this is for" }),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Choose a time"),
});

export const coachingBulkSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, "Give the sessions a title")
    .max(200, "That title is too long"),
  category: z.enum(COACHING_CATEGORIES, { message: "Choose a category" }),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"),
  coachId: z.string().uuid().nullable().optional(),
  location: z.string().trim().max(200).optional(),
  message: z.string().trim().max(1000).optional(),
  slots: z
    .array(coachingSlotSchema)
    .min(1, "Add at least one person")
    .refine(
      (slots) => new Set(slots.map((s) => s.consultantId)).size === slots.length,
      { message: "Each person can only appear once" },
    ),
});

export type CoachingBulkInput = z.infer<typeof coachingBulkSchema>;

/** What a consultant sends when asking for coaching. */
export const coachingRequestSchema = z.object({
  topic: z
    .string()
    .trim()
    .min(5, "Say briefly what you would like coaching on")
    .max(2000, "That is too long"),
  category: z.enum(COACHING_CATEGORIES, { message: "Choose a category" }),
});

/** Cancelling or declining. A refusal with no reason is worse than no record. */
export const coachingCancelSchema = z.object({
  sessionId: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(3, "Give a reason")
    .max(1000, "That reason is too long"),
});
