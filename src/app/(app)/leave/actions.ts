"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { recordAudit, auditSnapshot } from "@/lib/audit";
import { leavePeriodSchema, fieldErrors } from "@/lib/validation";
import { sgToday } from "@/lib/sg-date";
import type { LeavePeriod } from "@/types/database";

/**
 * Leave & Away Mode: create, edit, cancel.
 *
 * NO APPROVAL WORKFLOW, by design. An advisor declares their own leave and it
 * takes effect. The controls are therefore not gates but accountability: every
 * one of these three writes an audit row, and none of them can touch anybody
 * else's record.
 *
 * WHY THERE IS SO LITTLE AUTHORISATION CODE HERE
 *
 * Because it is in the database. Row Level Security on leave_periods already
 * says "your own rows, and only while the period has not finished", so a
 * request aimed at someone else's leave updates nothing rather than being
 * caught by a check here. These actions still pass their own user id, but as
 * a way of writing the correct row - not as the thing that makes it safe. An
 * authorisation rule that lives only in application code is one route handler
 * away from being bypassed.
 *
 * AWAY MODE NEVER BLOCKS A SUBMISSION
 *
 * Note what this file does not import: nothing from the submission or case
 * paths. Away Mode is read-only over the existing model - it changes what the
 * app asks at read time and never what it will accept at write time.
 */

export type LeaveActionResult = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string | undefined>;
};

const AUDITED_FIELDS = [
  "starts_on",
  "ends_on",
  "reason",
  "note",
  "cancelled_at",
] as const satisfies readonly (keyof LeavePeriod)[];

/**
 * Postgres 23P01 is an exclusion-constraint violation, which here can only be
 * leave_periods_no_overlap. Translated rather than surfaced: the constraint
 * name means nothing to an advisor, and "you already have leave booked over
 * some of those dates" tells them exactly what to change.
 *
 * This is caught from the database rather than checked beforehand on purpose.
 * A read-then-write check passes for two concurrent requests - both read,
 * neither sees the other, both insert - which is precisely what a
 * double-tapped Schedule button is.
 */
const OVERLAP = "23P01";

function overlapMessage(code?: string): string | null {
  return code === OVERLAP
    ? "You already have leave booked over some of those dates. Edit that period instead."
    : null;
}

function readForm(formData: FormData) {
  return {
    startsOn: String(formData.get("startsOn") ?? ""),
    endsOn: String(formData.get("endsOn") ?? ""),
    reason: String(formData.get("reason") ?? ""),
    note: String(formData.get("note") ?? ""),
  };
}

/** Everything Away Mode touches is derived, so every surface has to re-read. */
function revalidateEverything() {
  revalidatePath("/leave");
  // The dashboard carries the leave card and the missed-days notice; the
  // layout carries the banner and the Today badge, which is why "/" is in
  // here as well as the pages themselves.
  revalidatePath("/dashboard");
  revalidatePath("/today");
  revalidatePath("/", "layout");
}

export async function scheduleLeave(
  formData: FormData,
): Promise<LeaveActionResult> {
  const profile = await requireProfile();
  const parsed = leavePeriodSchema.safeParse(readForm(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the dates below.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }

  const { startsOn, endsOn, reason, note } = parsed.data;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("leave_periods")
    .insert({
      user_id: profile.id,
      starts_on: startsOn,
      ends_on: endsOn,
      reason,
      note: note?.trim() ? note.trim() : null,
    })
    .select("id, starts_on, ends_on, reason, note, cancelled_at")
    .single();

  if (error) {
    const overlap = overlapMessage(error.code);
    if (overlap) return { ok: false, message: overlap };

    console.error("[leave] schedule failed: %s (%s)", error.message, error.code);
    return { ok: false, message: "Could not save that. Please try again." };
  }

  await recordAudit(supabase, {
    actorUserId: profile.id,
    action: "leave_created",
    entityType: "leave_period",
    entityId: data.id,
    newValues: auditSnapshot(data, AUDITED_FIELDS),
  });

  revalidateEverything();

  // Said plainly, because it is the one thing an advisor wants confirmed
  // before they close the laptop and get on a plane.
  const backdated = endsOn < sgToday();
  return {
    ok: true,
    message: backdated
      ? "Leave recorded. Those days will no longer count against you."
      : "Leave scheduled. You will not be chased for a DART on those days.",
  };
}

export async function updateLeave(
  formData: FormData,
): Promise<LeaveActionResult> {
  const profile = await requireProfile();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, message: "Nothing to update." };

  const parsed = leavePeriodSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the dates below.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }

  const { startsOn, endsOn, reason, note } = parsed.data;
  const supabase = await createClient();

  // Read the old values first, for the audit trail. Self-declared leave with
  // no approval means the only account of what a period used to say is this.
  const { data: before } = await supabase
    .from("leave_periods")
    .select("id, starts_on, ends_on, reason, note, cancelled_at")
    .eq("id", id)
    .maybeSingle();

  const { data, error } = await supabase
    .from("leave_periods")
    .update({
      starts_on: startsOn,
      ends_on: endsOn,
      reason,
      note: note?.trim() ? note.trim() : null,
    })
    .eq("id", id)
    .select("id, starts_on, ends_on, reason, note, cancelled_at")
    .maybeSingle();

  if (error) {
    const overlap = overlapMessage(error.code);
    if (overlap) return { ok: false, message: overlap };

    console.error("[leave] update failed: %s (%s)", error.message, error.code);
    return { ok: false, message: "Could not save that. Please try again." };
  }

  // No row came back. RLS matched nothing, which means one of: it is not
  // theirs, it does not exist, or the period has already finished. All three
  // get the same answer - saying which would tell a prober something.
  if (!data) {
    return {
      ok: false,
      message:
        "That leave can no longer be changed. Periods that have already ended are kept as a record.",
    };
  }

  await recordAudit(supabase, {
    actorUserId: profile.id,
    action: "leave_updated",
    entityType: "leave_period",
    entityId: id,
    oldValues: auditSnapshot(before, AUDITED_FIELDS),
    newValues: auditSnapshot(data, AUDITED_FIELDS),
  });

  revalidateEverything();
  return { ok: true, message: "Leave updated." };
}

/**
 * Cancelling is an UPDATE, never a DELETE.
 *
 * There is no DELETE policy on the table for anyone, admins included. The
 * audit row recording a cancellation has to have something left to point at,
 * and "there is no record of it" says something quite different from "it was
 * cancelled on the 3rd".
 *
 * The confirmation step is in the UI, where the person is - a second server
 * round trip asking "are you sure" would only move the question somewhere it
 * is easier to click past.
 */
export async function cancelLeave(
  formData: FormData,
): Promise<LeaveActionResult> {
  const profile = await requireProfile();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, message: "Nothing to cancel." };

  const supabase = await createClient();

  const { data: before } = await supabase
    .from("leave_periods")
    .select("id, starts_on, ends_on, reason, note, cancelled_at")
    .eq("id", id)
    .maybeSingle();

  const { data, error } = await supabase
    .from("leave_periods")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("id", id)
    .is("cancelled_at", null)
    .select("id, starts_on, ends_on, reason, note, cancelled_at")
    .maybeSingle();

  if (error) {
    console.error("[leave] cancel failed: %s (%s)", error.message, error.code);
    return { ok: false, message: "Could not cancel that. Please try again." };
  }

  if (!data) {
    return {
      ok: false,
      message:
        "That leave could not be cancelled. It may already be cancelled, or have ended.",
    };
  }

  await recordAudit(supabase, {
    actorUserId: profile.id,
    action: "leave_cancelled",
    entityType: "leave_period",
    entityId: id,
    oldValues: auditSnapshot(before, AUDITED_FIELDS),
    newValues: auditSnapshot(data, AUDITED_FIELDS),
  });

  revalidateEverything();

  const wasActive =
    data.starts_on <= sgToday() && sgToday() <= data.ends_on;

  return {
    ok: true,
    message: wasActive
      ? "Away Mode is off. Normal reminders resume from tonight."
      : "Leave cancelled.",
  };
}
