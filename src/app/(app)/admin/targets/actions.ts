"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { targetSchema, insurerSchema, fieldErrors } from "@/lib/validation";

export type AdminActionResult = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string | undefined>;
};

/**
 * Set a GR target (decisions D4, D8, D17).
 *
 * Only admins reach here, including for their own target. That is acceptable
 * because every change is written to the append-only audit log with the old
 * and new value, so a self-serving edit is permanently attributable.
 */
export async function setTarget(
  formData: FormData,
): Promise<AdminActionResult> {
  const admin = await requireAdmin();

  const monthRaw = String(formData.get("month") ?? "");
  const parsed = targetSchema.safeParse({
    consultantId: String(formData.get("consultantId") ?? ""),
    year: Number(formData.get("year") ?? Number.NaN),
    month: monthRaw === "" || monthRaw === "null" ? null : Number(monthRaw),
    grTarget: Number(formData.get("grTarget") ?? Number.NaN),
  });

  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  }

  const { consultantId, year, month, grTarget } = parsed.data;
  const periodType = month === null ? "yearly" : "monthly";
  const supabase = await createClient();

  // Read the current value first so the audit trail shows the movement, not
  // just the destination.
  const existingQuery = supabase
    .from("consultant_targets")
    .select("*")
    .eq("consultant_id", consultantId)
    .eq("period_type", periodType)
    .eq("year", year);

  const { data: existing } = await (month === null
    ? existingQuery.is("month", null)
    : existingQuery.eq("month", month)
  ).maybeSingle();

  const { error } = existing
    ? await supabase
        .from("consultant_targets")
        .update({ gr_target: grTarget })
        .eq("id", existing.id)
    : await supabase.from("consultant_targets").insert({
        consultant_id: consultantId,
        period_type: periodType,
        year,
        month,
        gr_target: grTarget,
      });

  if (error) {
    return { ok: false, message: "That target could not be saved." };
  }

  await recordAudit(supabase, {
    actorUserId: admin.id,
    action: "target_changed",
    entityType: "consultant_targets",
    entityId: existing?.id ?? null,
    oldValues: existing
      ? { consultant_id: consultantId, period_type: periodType, year, month, gr_target: existing.gr_target }
      : null,
    newValues: { consultant_id: consultantId, period_type: periodType, year, month, gr_target: grTarget },
  });

  revalidatePath("/admin/targets");
  revalidatePath("/dashboard");
  revalidatePath("/admin");

  return {
    ok: true,
    message:
      month === null
        ? "Yearly target saved. Monthly defaults to a twelfth of it."
        : "Monthly override saved.",
  };
}

/** Remove a monthly override so the month falls back to yearly / 12. */
export async function clearMonthlyOverride(
  formData: FormData,
): Promise<AdminActionResult> {
  const admin = await requireAdmin();

  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("consultant_targets")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("consultant_targets")
    .delete()
    .eq("id", id)
    .eq("period_type", "monthly");

  if (error) {
    return { ok: false, message: "That override could not be removed." };
  }

  await recordAudit(supabase, {
    actorUserId: admin.id,
    action: "target_changed",
    entityType: "consultant_targets",
    entityId: id,
    oldValues: existing
      ? { gr_target: existing.gr_target, year: existing.year, month: existing.month }
      : null,
    newValues: null,
  });

  revalidatePath("/admin/targets");
  revalidatePath("/dashboard");

  return { ok: true, message: "Override removed. Back to a twelfth of the year." };
}

export async function renameInsurer(
  formData: FormData,
): Promise<AdminActionResult> {
  const admin = await requireAdmin();

  const id = String(formData.get("id") ?? "");
  const parsed = insurerSchema.safeParse({
    name: String(formData.get("name") ?? ""),
  });

  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  }

  const supabase = await createClient();

  const { data: before } = await supabase
    .from("insurers")
    .select("name")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("insurers")
    .update({ name: parsed.data.name })
    .eq("id", id);

  if (error) {
    return {
      ok: false,
      message: "Another insurer already uses that name.",
    };
  }

  await recordAudit(supabase, {
    actorUserId: admin.id,
    action: "insurer_updated",
    entityType: "insurers",
    entityId: id,
    oldValues: before ? { name: before.name } : null,
    newValues: { name: parsed.data.name },
  });

  revalidatePath("/admin/insurers");
  revalidatePath("/cases");
  revalidatePath("/admin/cases");

  return { ok: true, message: "Renamed. Existing cases follow automatically." };
}

/**
 * Retire or reinstate an insurer.
 *
 * Retiring only hides it from the picker for new cases. Existing cases keep
 * pointing at it, so historical reporting is untouched.
 */
export async function setInsurerActive(
  formData: FormData,
): Promise<AdminActionResult> {
  const admin = await requireAdmin();

  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";

  const supabase = await createClient();
  const { error } = await supabase
    .from("insurers")
    .update({ active })
    .eq("id", id);

  if (error) {
    return { ok: false, message: "That insurer could not be updated." };
  }

  await recordAudit(supabase, {
    actorUserId: admin.id,
    action: "insurer_updated",
    entityType: "insurers",
    entityId: id,
    newValues: { active },
  });

  revalidatePath("/admin/insurers");
  revalidatePath("/cases");

  return {
    ok: true,
    message: active
      ? "Reinstated."
      : "Retired. Existing cases are unaffected.",
  };
}
