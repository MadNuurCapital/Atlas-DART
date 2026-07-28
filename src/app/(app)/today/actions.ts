"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { recordAudit, auditSnapshot } from "@/lib/audit";
import {
  appointmentSchema,
  dailySubmissionSchema,
  fieldErrors,
} from "@/lib/validation";
import { isWithinEditWindow, sgToday } from "@/lib/sg-date";
import type { DailySubmission } from "@/types/database";

export type ActionResult = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string | undefined>;
};

const AUDITED_FIELDS = [
  "dials",
  "talked_to",
  "campaign_status",
  "in_office",
  "notes",
  "status",
] as const;

function parsePayload(formData: FormData) {
  const raw = {
    businessDate: String(formData.get("businessDate") ?? ""),
    dials: Number(formData.get("dials") ?? Number.NaN),
    talkedTo: Number(formData.get("talkedTo") ?? Number.NaN),
    campaignStatus: String(formData.get("campaignStatus") ?? ""),
    inOffice: formData.get("inOffice") === "true",
    notes: String(formData.get("notes") ?? ""),
  };
  return dailySubmissionSchema.safeParse(raw);
}

/**
 * Save or submit a day.
 *
 * The write is an upsert onto the unique (user_id, business_date) key rather
 * than a check-then-insert. That is what makes a double-click or a retried
 * request harmless: the second write lands on the same row, and the database
 * trigger decides whether anything actually changed.
 */
async function writeSubmission(
  formData: FormData,
  status: "draft" | "submitted",
): Promise<ActionResult> {
  const profile = await requireProfile();
  const parsed = parsePayload(formData);

  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  }

  const input = parsed.data;
  const supabase = await createClient();

  // Read the existing row first, so the audit trail can show what changed and
  // so we know whether this is a first submission or a revision.
  const { data: existing } = await supabase
    .from("daily_submissions")
    .select("*")
    .eq("user_id", profile.id)
    .eq("business_date", input.businessDate)
    .maybeSingle();

  // A submitted day stays submitted. The database refuses this too, but a
  // Postgres exception is not a sentence anyone can act on - and the reason it
  // matters is worth saying out loud, because from the form it looks harmless.
  if (status === "draft" && existing?.status === "submitted") {
    return {
      ok: false,
      message:
        "This day is already submitted, so it cannot be saved as a draft. Change the figures and resubmit instead.",
    };
  }

  const { data: saved, error } = await supabase
    .from("daily_submissions")
    .upsert(
      {
        user_id: profile.id,
        business_date: input.businessDate,
        dials: input.dials,
        talked_to: input.talkedTo,
        campaign_status: input.campaignStatus,
        in_office: input.inOffice,
        notes: input.notes?.trim() ? input.notes.trim() : null,
        status,
      },
      { onConflict: "user_id,business_date" },
    )
    .select("*")
    .single();

  if (error || !saved) {
    // The most likely cause is the RLS edit-window predicate rejecting an old
    // date, so say that rather than surfacing a Postgres error code.
    return {
      ok: false,
      message: isWithinEditWindow(input.businessDate)
        ? "That could not be saved. Please try again."
        : "That date is outside the seven-day window. Ask an admin to change it.",
    };
  }

  if (status === "submitted") {
    const isFirstSubmission = !existing?.first_submitted_at;
    await recordAudit(supabase, {
      actorUserId: profile.id,
      action: isFirstSubmission
        ? "daily_submission_created"
        : "daily_submission_resubmitted",
      entityType: "daily_submissions",
      entityId: saved.id,
      oldValues: auditSnapshot(existing as DailySubmission | null, AUDITED_FIELDS),
      newValues: auditSnapshot(saved as DailySubmission, AUDITED_FIELDS),
    });
  }

  revalidatePath("/today");
  revalidatePath("/dashboard");
  revalidatePath("/history");
  revalidatePath("/appointments");

  return {
    ok: true,
    message:
      status === "draft"
        ? "Draft saved."
        : existing?.first_submitted_at
          ? "Resubmitted. Your original submission time is unchanged."
          : "Submitted. Thank you.",
  };
}

export async function saveDraft(formData: FormData): Promise<ActionResult> {
  return writeSubmission(formData, "draft");
}

export async function submitDay(formData: FormData): Promise<ActionResult> {
  return writeSubmission(formData, "submitted");
}

/**
 * Make sure a submission row exists for a date, so an appointment has a parent
 * to attach to. Creating it as a draft means adding an appointment first -
 * which is how people actually work - does not accidentally mark the day as
 * submitted.
 */
async function ensureSubmission(
  businessDate: string,
  userId: string,
): Promise<string | null> {
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("daily_submissions")
    .select("id")
    .eq("user_id", userId)
    .eq("business_date", businessDate)
    .maybeSingle();

  if (existing) return existing.id;

  const { data: created } = await supabase
    .from("daily_submissions")
    .insert({
      user_id: userId,
      business_date: businessDate,
      dials: 0,
      talked_to: 0,
      campaign_status: "running",
      in_office: true,
      status: "draft",
    })
    .select("id")
    .single();

  return created?.id ?? null;
}

export async function addAppointment(
  formData: FormData,
): Promise<ActionResult> {
  const profile = await requireProfile();

  const parsed = appointmentSchema.safeParse({
    businessDate: String(formData.get("businessDate") ?? ""),
    prospectName: String(formData.get("prospectName") ?? ""),
    appointmentType: String(formData.get("appointmentType") ?? ""),
    note: String(formData.get("note") ?? ""),
  });

  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  }

  const submissionId = await ensureSubmission(
    parsed.data.businessDate,
    profile.id,
  );
  if (!submissionId) {
    return { ok: false, message: "Could not open that day for editing." };
  }

  const supabase = await createClient();
  // user_id and business_date are rewritten from the parent by a trigger, so
  // what is sent here cannot be used to attach an appointment to someone else.
  const { error } = await supabase.from("appointment_activities").insert({
    daily_submission_id: submissionId,
    user_id: profile.id,
    business_date: parsed.data.businessDate,
    prospect_name: parsed.data.prospectName,
    appointment_type: parsed.data.appointmentType,
    note: parsed.data.note?.trim() ? parsed.data.note.trim() : null,
  });

  if (error) {
    return { ok: false, message: "That appointment could not be added." };
  }

  revalidatePath("/today");
  revalidatePath("/appointments");
  revalidatePath("/dashboard");

  return { ok: true, message: "Appointment added." };
}

export async function updateAppointment(
  formData: FormData,
): Promise<ActionResult> {
  await requireProfile();

  const id = String(formData.get("id") ?? "");
  const parsed = appointmentSchema.safeParse({
    businessDate: String(formData.get("businessDate") ?? ""),
    prospectName: String(formData.get("prospectName") ?? ""),
    appointmentType: String(formData.get("appointmentType") ?? ""),
    note: String(formData.get("note") ?? ""),
  });

  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("appointment_activities")
    .update({
      prospect_name: parsed.data.prospectName,
      appointment_type: parsed.data.appointmentType,
      note: parsed.data.note?.trim() ? parsed.data.note.trim() : null,
    })
    .eq("id", id);

  if (error) {
    return { ok: false, message: "That appointment could not be updated." };
  }

  revalidatePath("/today");
  revalidatePath("/appointments");
  revalidatePath("/dashboard");

  return { ok: true, message: "Appointment updated." };
}

export async function deleteAppointment(
  formData: FormData,
): Promise<ActionResult> {
  await requireProfile();

  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();

  // RLS restricts this to the caller's own rows inside the edit window.
  const { error } = await supabase
    .from("appointment_activities")
    .delete()
    .eq("id", id);

  if (error) {
    return { ok: false, message: "That appointment could not be removed." };
  }

  revalidatePath("/today");
  revalidatePath("/appointments");
  revalidatePath("/dashboard");

  return { ok: true, message: "Appointment removed." };
}

/** Today's Singapore date, for a client that must not trust its own clock. */
export async function getServerToday(): Promise<string> {
  return sgToday();
}
