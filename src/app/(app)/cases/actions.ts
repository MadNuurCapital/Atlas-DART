"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, requireAdmin } from "@/lib/auth";
import { recordAudit, auditSnapshot } from "@/lib/audit";
import {
  caseSchema,
  cancelCaseSchema,
  insurerSchema,
  fieldErrors,
  sameInsurerName,
  type CaseInput,
} from "@/lib/validation";
import type { Case } from "@/types/database";

export type CaseActionResult = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string | undefined>;
  /** Set when a new insurer was created inline, so the form can select it. */
  insurerId?: string;
};

const AUDITED_FIELDS = [
  "date_submitted",
  "date_incepted",
  "client_name",
  "insurer_id",
  "policy_name",
  "policy_type",
  "ape_amount",
  "gr_amount",
  "status",
  "cancellation_reason",
] as const;

function parseCase(formData: FormData) {
  return caseSchema.safeParse({
    dateSubmitted: String(formData.get("dateSubmitted") ?? ""),
    dateIncepted: String(formData.get("dateIncepted") ?? ""),
    clientName: String(formData.get("clientName") ?? ""),
    insurerId: String(formData.get("insurerId") ?? ""),
    policyName: String(formData.get("policyName") ?? ""),
    policyType: String(formData.get("policyType") ?? ""),
    apeAmount: Number(formData.get("apeAmount") ?? Number.NaN),
    grAmount: Number(formData.get("grAmount") ?? Number.NaN),
  });
}

function toRow(input: CaseInput) {
  return {
    date_submitted: input.dateSubmitted,
    date_incepted: input.dateIncepted ? input.dateIncepted : null,
    client_name: input.clientName,
    insurer_id: input.insurerId,
    policy_name: input.policyName,
    policy_type: input.policyType,
    ape_amount: input.apeAmount,
    gr_amount: input.grAmount,
  };
}

export async function createCase(
  formData: FormData,
): Promise<CaseActionResult> {
  const profile = await requireProfile();
  const parsed = parseCase(formData);

  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cases")
    .insert({ consultant_id: profile.id, ...toRow(parsed.data) })
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, message: "That case could not be saved." };
  }

  await recordAudit(supabase, {
    actorUserId: profile.id,
    action: "case_created",
    entityType: "cases",
    entityId: data.id,
    newValues: auditSnapshot(data as Case, AUDITED_FIELDS),
  });

  revalidateCasePaths();
  return { ok: true, message: "Case added." };
}

export async function updateCase(
  formData: FormData,
): Promise<CaseActionResult> {
  const profile = await requireProfile();
  const id = String(formData.get("id") ?? "");
  const parsed = parseCase(formData);

  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  }

  const supabase = await createClient();

  const { data: before } = await supabase
    .from("cases")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  const { data: after, error } = await supabase
    .from("cases")
    .update(toRow(parsed.data))
    .eq("id", id)
    .select("*")
    .single();

  if (error || !after) {
    return { ok: false, message: "That case could not be updated." };
  }

  await recordAudit(supabase, {
    actorUserId: profile.id,
    action: "case_updated",
    entityType: "cases",
    entityId: id,
    oldValues: auditSnapshot(before as Case | null, AUDITED_FIELDS),
    newValues: auditSnapshot(after as Case, AUDITED_FIELDS),
  });

  revalidateCasePaths();
  return { ok: true, message: "Case updated." };
}

/**
 * Cancel and remove from totals.
 *
 * Never a delete. The row survives in full so a mistake can be corrected, and
 * so the Case Tracker sheet can still show what was written and why it went.
 */
export async function cancelCase(
  formData: FormData,
): Promise<CaseActionResult> {
  const profile = await requireProfile();

  const parsed = cancelCaseSchema.safeParse({
    caseId: String(formData.get("caseId") ?? ""),
    reason: String(formData.get("reason") ?? ""),
  });

  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  }

  const supabase = await createClient();

  const { data: before } = await supabase
    .from("cases")
    .select("*")
    .eq("id", parsed.data.caseId)
    .maybeSingle();

  const { data: after, error } = await supabase
    .from("cases")
    .update({
      status: "cancelled",
      cancellation_reason: parsed.data.reason,
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.caseId)
    .select("*")
    .single();

  if (error || !after) {
    return { ok: false, message: "That case could not be cancelled." };
  }

  await recordAudit(supabase, {
    actorUserId: profile.id,
    action: "case_cancelled",
    entityType: "cases",
    entityId: parsed.data.caseId,
    oldValues: auditSnapshot(before as Case | null, AUDITED_FIELDS),
    newValues: auditSnapshot(after as Case, AUDITED_FIELDS),
  });

  revalidateCasePaths();
  return {
    ok: true,
    message: "Cancelled and removed from totals. The record is kept.",
  };
}

/** Restoring is an admin action - the database trigger enforces that too. */
export async function restoreCase(
  formData: FormData,
): Promise<CaseActionResult> {
  const admin = await requireAdmin();
  const id = String(formData.get("caseId") ?? "");

  const supabase = await createClient();

  const { data: before } = await supabase
    .from("cases")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  const { data: after, error } = await supabase
    .from("cases")
    .update({ status: "active", cancellation_reason: null, cancelled_at: null })
    .eq("id", id)
    .select("*")
    .single();

  if (error || !after) {
    return { ok: false, message: "That case could not be restored." };
  }

  await recordAudit(supabase, {
    actorUserId: admin.id,
    action: "case_restored",
    entityType: "cases",
    entityId: id,
    oldValues: auditSnapshot(before as Case | null, AUDITED_FIELDS),
    newValues: auditSnapshot(after as Case, AUDITED_FIELDS),
  });

  revalidateCasePaths();
  return { ok: true, message: "Case restored and counting again." };
}

/**
 * Add an insurer inline (decision D19).
 *
 * The unique index on lower(btrim(name)) is what keeps reporting intact. When
 * it fires we do not show an error - we find the existing insurer and hand its
 * id back, so the consultant simply gets the one that already exists.
 */
export async function createInsurer(
  formData: FormData,
): Promise<CaseActionResult> {
  const profile = await requireProfile();

  const parsed = insurerSchema.safeParse({
    name: String(formData.get("name") ?? ""),
  });

  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("insurers")
    .insert({ name: parsed.data.name, created_by: profile.id })
    .select("id, name")
    .single();

  if (error) {
    const { data: existing } = await supabase
      .from("insurers")
      .select("id, name")
      .ilike("name", parsed.data.name)
      .maybeSingle();

    // ilike treats %, _ and * as wildcards, so a name containing one could
    // match a DIFFERENT insurer - and silently filing a case under the wrong
    // one is worse than making someone retype the name. Confirm the match is
    // genuine before handing its id back.
    if (existing && sameInsurerName(existing.name, parsed.data.name)) {
      return {
        ok: true,
        insurerId: existing.id,
        message: `Using the existing "${existing.name}".`,
      };
    }
    return { ok: false, message: "That insurer could not be added." };
  }

  await recordAudit(supabase, {
    actorUserId: profile.id,
    action: "insurer_created",
    entityType: "insurers",
    entityId: data.id,
    newValues: { name: data.name },
  });

  revalidatePath("/cases");
  revalidatePath("/admin/insurers");

  return { ok: true, insurerId: data.id, message: `Added ${data.name}.` };
}

function revalidateCasePaths() {
  revalidatePath("/cases");
  revalidatePath("/dashboard");
  revalidatePath("/admin");
  revalidatePath("/admin/cases");
}
