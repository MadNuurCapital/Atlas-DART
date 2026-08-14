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

/**
 * What was just written, for the congratulations panel to name.
 *
 * Returned only by createCase. An edit is bookkeeping; a new case is the thing
 * the job is actually for, and it is worth marking.
 */
export type CaseCelebration = {
  clientName: string;
  policyType: string;
  grAmount: number;
  /** Their active GR for the month this case counts in, including this one. */
  monthToDateGr: number;
  monthLabel: string;
};

export type CaseActionResult = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string | undefined>;
  /** Set when a new insurer was created inline, so the form can select it. */
  insurerId?: string;
  /** Set only on a successful create. */
  celebrate?: CaseCelebration;
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

  // Their month-to-date total, read AFTER the insert so the new case is in it.
  // Deliberately not computed by adding the new GR to a previously-read total:
  // that would drift the moment a case was cancelled or edited in another tab,
  // and a congratulations screen showing the wrong figure is worse than one
  // showing none. A failure here costs the total, not the case - the case is
  // already saved, so this must never turn a success into an error.
  const created = data as Case;
  const monthStart = created.date_submitted.slice(0, 8) + "01";
  const monthEnd = lastDayOfMonth(created.date_submitted);

  let monthToDateGr = 0;
  const { data: monthCases, error: totalError } = await supabase
    .from("cases")
    .select("gr_amount")
    .eq("consultant_id", profile.id)
    .eq("status", "active")
    .gte("date_submitted", monthStart)
    .lte("date_submitted", monthEnd);

  if (totalError) {
    console.error(
      "[cases] case saved but the month total could not be read: %s",
      totalError.message,
    );
  } else {
    monthToDateGr = (monthCases ?? []).reduce(
      (sum, row) => sum + Number(row.gr_amount ?? 0),
      0,
    );
  }

  return {
    ok: true,
    message: "Case added.",
    celebrate: {
      clientName: created.client_name,
      policyType: created.policy_type,
      grAmount: Number(created.gr_amount ?? 0),
      monthToDateGr,
      monthLabel: monthNameOf(created.date_submitted),
    },
  };
}

/** Last calendar day of the month a business date falls in, as YYYY-MM-DD. */
function lastDayOfMonth(businessDate: string): string {
  const [y, m] = businessDate.split("-").map(Number) as [number, number];
  // Day 0 of the next month is the last day of this one.
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

/** "August" from a business date, for the congratulations line. */
function monthNameOf(businessDate: string): string {
  const [y, m, d] = businessDate.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return new Intl.DateTimeFormat("en-SG", { month: "long" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
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
