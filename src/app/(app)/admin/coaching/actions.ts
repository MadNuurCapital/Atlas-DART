"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { sgDateTimeToInstant } from "@/lib/sg-date";
import {
  coachingBulkSchema,
  coachingCancelSchema,
  coachingSessionSchema,
  fieldErrors,
} from "@/lib/validation";

export type CoachingAdminResult = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string | undefined>;
  /** How many sessions a bulk booking created. */
  created?: number;
};

const DEFAULT_MESSAGE =
  "Please be reminded that you have an upcoming coaching session.";

function revalidateCoaching() {
  revalidatePath("/admin/coaching");
  revalidatePath("/dashboard");
  revalidatePath("/admin");
}

/**
 * Send the "you have been booked" notification.
 *
 * Deliberately never allowed to fail the booking. A session that exists but
 * whose notification did not send is recoverable - the card is on their
 * dashboard and two more reminders follow. A booking that was refused because
 * a push service had a bad second is not.
 */
async function notifyAssigned(
  sessionId: string,
  consultantId: string,
  title: string,
  whenLabel: string,
): Promise<void> {
  try {
    const { notifyCoaching } = await import("@/lib/coaching-notify");
    await notifyCoaching({
      sessionId,
      consultantId,
      kind: "assigned",
      title: "Coaching booked",
      body: `${title} - ${whenLabel}`,
    });
  } catch (error) {
    console.error("[coaching] assignment notification failed", error);
  }
}

/** Book one session for one person. */
export async function createCoaching(
  formData: FormData,
): Promise<CoachingAdminResult> {
  const admin = await requireAdmin();

  const parsed = coachingSessionSchema.safeParse({
    consultantId: String(formData.get("consultantId") ?? ""),
    coachId: String(formData.get("coachId") ?? "") || null,
    title: String(formData.get("title") ?? ""),
    category: String(formData.get("category") ?? ""),
    date: String(formData.get("date") ?? ""),
    time: String(formData.get("time") ?? ""),
    location: String(formData.get("location") ?? ""),
    message: String(formData.get("message") ?? ""),
    agenda: String(formData.get("agenda") ?? ""),
  });

  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  }

  const at = sgDateTimeToInstant(parsed.data.date, parsed.data.time);
  if (!at) {
    return { ok: false, fieldErrors: { date: "That is not a real date and time" } };
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("coaching_sessions")
    .insert({
      consultant_id: parsed.data.consultantId,
      coach_id: parsed.data.coachId ?? admin.id,
      created_by: admin.id,
      title: parsed.data.title,
      category: parsed.data.category,
      status: "scheduled",
      scheduled_at: at.toISOString(),
      location: parsed.data.location || null,
      message: parsed.data.message || DEFAULT_MESSAGE,
      agenda: parsed.data.agenda || null,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[coaching] create failed: %s", error?.message);
    return { ok: false, message: "That session could not be booked." };
  }

  await recordAudit(supabase, {
    actorUserId: admin.id,
    action: "coaching_created",
    entityType: "coaching_sessions",
    entityId: data.id,
    newValues: {
      consultant_id: parsed.data.consultantId,
      title: parsed.data.title,
      category: parsed.data.category,
      scheduled_at: at.toISOString(),
    },
  });

  await notifyAssigned(
    data.id,
    parsed.data.consultantId,
    parsed.data.title,
    at.toISOString(),
  );

  revalidateCoaching();
  return { ok: true, message: "Coaching booked." };
}

/**
 * Book the same session for several people, each at their own time.
 *
 * Twenty monthly reviews on one afternoon is the case this exists for. Each
 * row is independent once created - editing, rescheduling or cancelling one
 * does not touch the others, which is what makes this simpler than a recurring
 * series.
 */
export async function createCoachingBulk(
  formData: FormData,
): Promise<CoachingAdminResult> {
  const admin = await requireAdmin();

  let slots: unknown = [];
  try {
    slots = JSON.parse(String(formData.get("slots") ?? "[]"));
  } catch {
    return { ok: false, message: "Those bookings could not be read." };
  }

  const parsed = coachingBulkSchema.safeParse({
    title: String(formData.get("title") ?? ""),
    category: String(formData.get("category") ?? ""),
    date: String(formData.get("date") ?? ""),
    coachId: String(formData.get("coachId") ?? "") || null,
    location: String(formData.get("location") ?? ""),
    message: String(formData.get("message") ?? ""),
    slots,
  });

  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  }

  const rows: {
    consultantId: string;
    at: Date;
  }[] = [];

  for (const slot of parsed.data.slots) {
    const at = sgDateTimeToInstant(parsed.data.date, slot.time);
    if (!at) {
      return { ok: false, fieldErrors: { date: "That is not a real date and time" } };
    }
    rows.push({ consultantId: slot.consultantId, at });
  }

  const supabase = await createClient();

  // One insert rather than one per person: twenty separate round trips to
  // Singapore is a visibly slow form, and a partial failure halfway through
  // would leave an unclear mess to tidy up.
  const { data, error } = await supabase
    .from("coaching_sessions")
    .insert(
      rows.map((row) => ({
        consultant_id: row.consultantId,
        coach_id: parsed.data.coachId ?? admin.id,
        created_by: admin.id,
        title: parsed.data.title,
        category: parsed.data.category,
        status: "scheduled" as const,
        scheduled_at: row.at.toISOString(),
        location: parsed.data.location || null,
        message: parsed.data.message || DEFAULT_MESSAGE,
      })),
    )
    .select("id, consultant_id, scheduled_at");

  if (error || !data || data.length === 0) {
    console.error("[coaching] bulk create failed: %s", error?.message);
    return { ok: false, message: "Those sessions could not be booked." };
  }

  for (const created of data) {
    await recordAudit(supabase, {
      actorUserId: admin.id,
      action: "coaching_created",
      entityType: "coaching_sessions",
      entityId: created.id,
      newValues: {
        consultant_id: created.consultant_id,
        title: parsed.data.title,
        category: parsed.data.category,
        scheduled_at: created.scheduled_at,
      },
    });

    await notifyAssigned(
      created.id,
      created.consultant_id,
      parsed.data.title,
      created.scheduled_at ?? "",
    );
  }

  revalidateCoaching();
  return {
    ok: true,
    created: data.length,
    message: `${data.length} session${data.length === 1 ? "" : "s"} booked.`,
  };
}

/**
 * Turn a consultant's request into a real session, or edit an existing one.
 *
 * Moving the time clears the acknowledgement - owned by a database trigger, so
 * it holds however the row is written - and sends a fresh notification.
 */
export async function scheduleCoaching(
  formData: FormData,
): Promise<CoachingAdminResult> {
  const admin = await requireAdmin();
  const sessionId = String(formData.get("sessionId") ?? "");

  const parsed = coachingSessionSchema.safeParse({
    consultantId: String(formData.get("consultantId") ?? ""),
    coachId: String(formData.get("coachId") ?? "") || null,
    title: String(formData.get("title") ?? ""),
    category: String(formData.get("category") ?? ""),
    date: String(formData.get("date") ?? ""),
    time: String(formData.get("time") ?? ""),
    location: String(formData.get("location") ?? ""),
    message: String(formData.get("message") ?? ""),
    agenda: String(formData.get("agenda") ?? ""),
  });

  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  }

  const at = sgDateTimeToInstant(parsed.data.date, parsed.data.time);
  if (!at) {
    return { ok: false, fieldErrors: { date: "That is not a real date and time" } };
  }

  const supabase = await createClient();

  const { data: before } = await supabase
    .from("coaching_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();

  if (!before) {
    return { ok: false, message: "That session could not be found." };
  }

  const wasRequest = before.status === "requested";
  const moved = before.scheduled_at !== at.toISOString();

  const { data, error } = await supabase
    .from("coaching_sessions")
    .update({
      coach_id: parsed.data.coachId ?? before.coach_id ?? admin.id,
      title: parsed.data.title,
      category: parsed.data.category,
      status: "scheduled",
      scheduled_at: at.toISOString(),
      location: parsed.data.location || null,
      message: parsed.data.message || DEFAULT_MESSAGE,
      agenda: parsed.data.agenda || null,
    })
    .eq("id", sessionId)
    .select("id, consultant_id")
    .single();

  if (error || !data) {
    console.error("[coaching] schedule failed: %s", error?.message);
    return { ok: false, message: "That session could not be saved." };
  }

  await recordAudit(supabase, {
    actorUserId: admin.id,
    action: wasRequest
      ? "coaching_scheduled"
      : moved
        ? "coaching_rescheduled"
        : "coaching_updated",
    entityType: "coaching_sessions",
    entityId: sessionId,
    oldValues: {
      status: before.status,
      scheduled_at: before.scheduled_at,
      title: before.title,
    },
    newValues: {
      status: "scheduled",
      scheduled_at: at.toISOString(),
      title: parsed.data.title,
    },
  });

  if (wasRequest || moved) {
    try {
      const { notifyCoaching } = await import("@/lib/coaching-notify");
      await notifyCoaching({
        sessionId,
        consultantId: data.consultant_id,
        kind: wasRequest ? "assigned" : "rescheduled",
        title: wasRequest ? "Coaching booked" : "Coaching moved",
        body: `${parsed.data.title} - please check the new time`,
        replaceExisting: true,
      });
    } catch (error) {
      console.error("[coaching] schedule notification failed", error);
    }
  }

  revalidateCoaching();
  return {
    ok: true,
    message: wasRequest
      ? "Scheduled. They have been notified."
      : moved
        ? "Moved. They have been notified and must acknowledge again."
        : "Saved.",
  };
}

/** Cancel a booked session, or decline a request. Both need a reason. */
export async function cancelCoaching(
  formData: FormData,
): Promise<CoachingAdminResult> {
  const admin = await requireAdmin();

  const parsed = coachingCancelSchema.safeParse({
    sessionId: String(formData.get("sessionId") ?? ""),
    reason: String(formData.get("reason") ?? ""),
  });

  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  }

  const supabase = await createClient();

  const { data: before } = await supabase
    .from("coaching_sessions")
    .select("status, title, consultant_id")
    .eq("id", parsed.data.sessionId)
    .maybeSingle();

  if (!before) {
    return { ok: false, message: "That session could not be found." };
  }

  // Declining a request and cancelling a booked session are different events,
  // kept apart so that saying no to a request does not read in the reports as
  // calling off a meeting that was arranged.
  const declining = before.status === "requested";

  const { data, error } = await supabase
    .from("coaching_sessions")
    .update({
      status: declining ? "declined" : "cancelled",
      cancelled_at: new Date().toISOString(),
      cancellation_reason: parsed.data.reason,
      acknowledged_at: null,
    })
    .eq("id", parsed.data.sessionId)
    .select("id, consultant_id")
    .single();

  if (error || !data) {
    console.error("[coaching] cancel failed: %s", error?.message);
    return { ok: false, message: "That could not be cancelled." };
  }

  await recordAudit(supabase, {
    actorUserId: admin.id,
    action: declining ? "coaching_declined" : "coaching_cancelled",
    entityType: "coaching_sessions",
    entityId: parsed.data.sessionId,
    oldValues: { status: before.status, title: before.title },
    newValues: {
      status: declining ? "declined" : "cancelled",
      reason: parsed.data.reason,
    },
  });

  try {
    const { notifyCoaching } = await import("@/lib/coaching-notify");
    await notifyCoaching({
      sessionId: parsed.data.sessionId,
      consultantId: data.consultant_id,
      kind: "cancelled",
      title: declining ? "Coaching request declined" : "Coaching cancelled",
      body: parsed.data.reason,
      replaceExisting: true,
    });
  } catch (error) {
    console.error("[coaching] cancellation notification failed", error);
  }

  revalidateCoaching();
  return {
    ok: true,
    message: declining
      ? "Declined. They have been told why."
      : "Cancelled. They have been told why.",
  };
}

/** Mark a session completed, missed, or put a completed one back. */
export async function setCoachingOutcome(
  formData: FormData,
): Promise<CoachingAdminResult> {
  const admin = await requireAdmin();

  const sessionId = String(formData.get("sessionId") ?? "");
  const outcome = String(formData.get("outcome") ?? "");

  if (!["completed", "missed", "reopen"].includes(outcome)) {
    return { ok: false, message: "That is not a valid outcome." };
  }

  const supabase = await createClient();

  const { data: before } = await supabase
    .from("coaching_sessions")
    .select("status")
    .eq("id", sessionId)
    .maybeSingle();

  if (!before) {
    return { ok: false, message: "That session could not be found." };
  }

  const status =
    outcome === "reopen"
      ? ("scheduled" as const)
      : outcome === "completed"
        ? ("completed" as const)
        : ("missed" as const);

  const { data, error } = await supabase
    .from("coaching_sessions")
    .update({
      status,
      completed_at: outcome === "completed" ? new Date().toISOString() : null,
    })
    .eq("id", sessionId)
    .select("id")
    .single();

  if (error || !data) {
    console.error("[coaching] outcome failed: %s", error?.message);
    return { ok: false, message: "That could not be updated." };
  }

  await recordAudit(supabase, {
    actorUserId: admin.id,
    action:
      outcome === "completed"
        ? "coaching_completed"
        : outcome === "missed"
          ? "coaching_missed"
          : "coaching_reopened",
    entityType: "coaching_sessions",
    entityId: sessionId,
    oldValues: { status: before.status },
    newValues: { status },
  });

  revalidateCoaching();
  return {
    ok: true,
    message:
      outcome === "completed"
        ? "Marked completed."
        : outcome === "missed"
          ? "Marked as missed."
          : "Reopened.",
  };
}

/** Save the admin-only notes. Never visible to the person being coached. */
export async function saveCoachingNotes(
  formData: FormData,
): Promise<CoachingAdminResult> {
  const admin = await requireAdmin();

  const sessionId = String(formData.get("sessionId") ?? "");
  const internal = String(formData.get("internalNotes") ?? "").trim();
  const outcome = String(formData.get("outcomeNotes") ?? "").trim();

  if (internal.length > 4000 || outcome.length > 4000) {
    return { ok: false, message: "Those notes are too long." };
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("coaching_notes")
    .upsert(
      {
        session_id: sessionId,
        internal_notes: internal || null,
        outcome_notes: outcome || null,
      },
      { onConflict: "session_id" },
    )
    .select("session_id");

  if (error || !data || data.length === 0) {
    console.error("[coaching] notes failed: %s", error?.message);
    return { ok: false, message: "Those notes could not be saved." };
  }

  await recordAudit(supabase, {
    actorUserId: admin.id,
    action: "coaching_updated",
    entityType: "coaching_notes",
    entityId: sessionId,
    // Deliberately not recording the note text. The audit trail is visible to
    // every admin, which is fine, but it is not a second copy of the notes.
    newValues: { notes_updated: true },
  });

  revalidatePath("/admin/coaching");
  return { ok: true, message: "Notes saved." };
}
