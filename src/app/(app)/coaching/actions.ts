"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { coachingRequestSchema, fieldErrors } from "@/lib/validation";

export type CoachingActionResult = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string | undefined>;
};

/**
 * A consultant asking to be coached.
 *
 * The row is inserted with no time on it and status 'requested'; scheduling is
 * management's to do. consultant_id and created_by are both taken from the
 * session rather than from the form - the insert policy requires them to equal
 * auth.uid(), so a forged request for somebody else is refused by Postgres
 * before it reaches this code's assumptions.
 */
export async function requestCoaching(
  formData: FormData,
): Promise<CoachingActionResult> {
  const profile = await requireProfile();

  const parsed = coachingRequestSchema.safeParse({
    topic: String(formData.get("topic") ?? ""),
    category: String(formData.get("category") ?? ""),
  });

  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  }

  const supabase = await createClient();

  // One open request at a time. Without this, tapping the button twice on a
  // slow connection leaves two identical requests in the admin queue.
  const { data: existing } = await supabase
    .from("coaching_sessions")
    .select("id")
    .eq("consultant_id", profile.id)
    .eq("status", "requested")
    .limit(1);

  if (existing && existing.length > 0) {
    return {
      ok: false,
      message:
        "You already have a coaching request waiting. Your admin will be in touch.",
    };
  }

  const { data, error } = await supabase
    .from("coaching_sessions")
    .insert({
      consultant_id: profile.id,
      created_by: profile.id,
      title: "Coaching request",
      category: parsed.data.category,
      status: "requested",
      requested_topic: parsed.data.topic,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[coaching] request failed: %s", error?.message);
    return { ok: false, message: "That request could not be sent." };
  }

  await recordAudit(supabase, {
    actorUserId: profile.id,
    action: "coaching_requested",
    entityType: "coaching_sessions",
    entityId: data.id,
    newValues: { category: parsed.data.category, topic: parsed.data.topic },
  });

  revalidatePath("/dashboard");
  revalidatePath("/admin/coaching");

  return {
    ok: true,
    message: "Request sent. Your admin will schedule it.",
  };
}

/**
 * Acknowledging a session.
 *
 * The only column a consultant may write, enforced by a trigger rather than by
 * this code. The returned row is checked because an update Row Level Security
 * filters out succeeds having changed nothing.
 */
export async function acknowledgeCoaching(
  formData: FormData,
): Promise<CoachingActionResult> {
  const profile = await requireProfile();
  const sessionId = String(formData.get("sessionId") ?? "");

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("coaching_sessions")
    .update({ acknowledged_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("status", "scheduled")
    .select("id")
    .single();

  if (error || !data) {
    return {
      ok: false,
      message: "That could not be acknowledged. Try refreshing the page.",
    };
  }

  await recordAudit(supabase, {
    actorUserId: profile.id,
    action: "coaching_acknowledged",
    entityType: "coaching_sessions",
    entityId: sessionId,
    newValues: { acknowledged: true },
  });

  revalidatePath("/dashboard");
  revalidatePath("/admin/coaching");

  return { ok: true, message: "Thanks - your admin can see you have it." };
}
