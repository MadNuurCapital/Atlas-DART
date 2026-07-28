"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { inviteUserSchema, fieldErrors } from "@/lib/validation";
import { ROLES, type Role } from "@/lib/constants";

export type UserActionResult = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string | undefined>;
  /** Present when the invite email could not be sent and a password was set. */
  temporaryPassword?: string;
};

/**
 * A password to hand over when email is not configured.
 *
 * Long and random rather than memorable: it exists to be copied once and then
 * changed by the recipient, not typed from memory.
 */
function temporaryPassword(): string {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/**
 * Invite someone.
 *
 * Two paths, because Supabase's built-in email sender is rate-limited to a
 * handful per hour and is not intended for production. If the invite email
 * fails - which it will if SMTP is not yet configured - the account is still
 * created with a temporary password that the admin hands over directly. A
 * blocked launch day is worse than an inelegant one.
 */
export async function inviteUser(
  formData: FormData,
): Promise<UserActionResult> {
  const admin = await requireAdmin();

  const parsed = inviteUserSchema.safeParse({
    fullName: String(formData.get("fullName") ?? ""),
    email: String(formData.get("email") ?? ""),
    role: String(formData.get("role") ?? ""),
  });

  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  }

  const { fullName, email, role } = parsed.data;
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("profiles")
    .select("id, full_name, active")
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    return {
      ok: false,
      fieldErrors: {
        email: existing.active
          ? `${existing.full_name} already has an account with that email.`
          : `${existing.full_name} has a deactivated account with that email. Reactivate it instead of creating a second one.`,
      },
    };
  }

  const service = createAdminClient();
  const metadata = { full_name: fullName, role };
  const redirectTo = process.env.APP_URL
    ? `${process.env.APP_URL}/login`
    : undefined;

  // Preferred path: an email letting them choose their own password.
  const invite = await service.auth.admin.inviteUserByEmail(email, {
    data: metadata,
    ...(redirectTo ? { redirectTo } : {}),
  });

  if (!invite.error && invite.data.user) {
    await recordAudit(supabase, {
      actorUserId: admin.id,
      action: "user_invited",
      entityType: "profiles",
      entityId: invite.data.user.id,
      newValues: { full_name: fullName, email, role, method: "email" },
    });

    revalidatePath("/admin/users");
    return { ok: true, message: `Invitation sent to ${email}.` };
  }

  // Fallback: create the account directly and hand over a password.
  const password = temporaryPassword();
  const created = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: metadata,
  });

  if (created.error || !created.data.user) {
    console.error(
      "[users] invite and createUser both failed for %s: %s",
      email,
      created.error?.message ?? invite.error?.message,
    );
    return {
      ok: false,
      message:
        created.error?.message ??
        "That account could not be created. Check the Supabase service key.",
    };
  }

  await recordAudit(supabase, {
    actorUserId: admin.id,
    action: "user_invited",
    entityType: "profiles",
    entityId: created.data.user.id,
    newValues: {
      full_name: fullName,
      email,
      role,
      method: "temporary_password",
    },
  });

  revalidatePath("/admin/users");

  return {
    ok: true,
    temporaryPassword: password,
    message:
      "Account created, but the invitation email could not be sent. Give them this password directly and ask them to change it.",
  };
}

/** Promote or demote. Audit-logged, including an admin changing their own. */
export async function setUserRole(
  formData: FormData,
): Promise<UserActionResult> {
  const admin = await requireAdmin();

  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "") as Role;

  if (!ROLES.includes(role)) {
    return { ok: false, message: "That is not a valid role." };
  }

  const supabase = await createClient();

  const { data: before } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", userId)
    .maybeSingle();

  if (!before) return { ok: false, message: "That person could not be found." };
  if (before.role === role) return { ok: true };

  // Refuse to remove the last admin. Nobody could then invite, set targets or
  // restore a case - the application would need a database console to recover.
  if (before.role === "admin" && role === "consultant") {
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin")
      .eq("active", true);

    if ((count ?? 0) <= 1) {
      return {
        ok: false,
        message:
          "That is the last active admin. Promote someone else before demoting them.",
      };
    }
  }

  const { error } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", userId);

  if (error) {
    return { ok: false, message: "That role could not be changed." };
  }

  await recordAudit(supabase, {
    actorUserId: admin.id,
    action: "user_role_changed",
    entityType: "profiles",
    entityId: userId,
    oldValues: { full_name: before.full_name, role: before.role },
    newValues: { full_name: before.full_name, role },
  });

  revalidatePath("/admin/users");
  revalidatePath("/admin");

  return {
    ok: true,
    message: `${before.full_name} is now ${role === "admin" ? "an admin" : "a consultant"}.`,
  };
}

/**
 * Deactivate a leaver, or reactivate someone.
 *
 * Deactivating stops their reminders and drops them from missing lists and
 * compliance, while every historical figure they produced stays exactly where
 * it is in past reports. It is not a delete and never should be.
 */
export async function setUserActive(
  formData: FormData,
): Promise<UserActionResult> {
  const admin = await requireAdmin();

  const userId = String(formData.get("userId") ?? "");
  const active = String(formData.get("active") ?? "") === "true";

  const supabase = await createClient();

  const { data: before } = await supabase
    .from("profiles")
    .select("full_name, role, active")
    .eq("id", userId)
    .maybeSingle();

  if (!before) return { ok: false, message: "That person could not be found." };
  if (before.active === active) return { ok: true };

  if (!active && before.role === "admin") {
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin")
      .eq("active", true);

    if ((count ?? 0) <= 1) {
      return {
        ok: false,
        message:
          "That is the last active admin. Promote someone else before deactivating them.",
      };
    }
  }

  const { error } = await supabase
    .from("profiles")
    .update({ active })
    .eq("id", userId);

  if (error) {
    return { ok: false, message: "That account could not be updated." };
  }

  await recordAudit(supabase, {
    actorUserId: admin.id,
    action: active ? "user_reactivated" : "user_deactivated",
    entityType: "profiles",
    entityId: userId,
    oldValues: { full_name: before.full_name, active: before.active },
    newValues: { full_name: before.full_name, active },
  });

  revalidatePath("/admin/users");
  revalidatePath("/admin");

  return {
    ok: true,
    message: active
      ? `${before.full_name} is active again.`
      : `${before.full_name} is deactivated. Their history is untouched.`,
  };
}
