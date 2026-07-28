import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/database";

/**
 * The signed-in user's profile, or a redirect to login.
 *
 * Every server component and server action that needs to know who is asking
 * should go through here rather than reading the session directly, so the
 * "authenticated but no profile row" case is handled in exactly one place.
 */
export async function requireProfile(): Promise<Profile> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) {
    // Authenticated with no profile row. This should be impossible - the
    // on_auth_user_created trigger creates one - but signing them out is the
    // only safe response, since we cannot establish their role.
    await supabase.auth.signOut();
    redirect("/login");
  }

  return profile;
}

/**
 * Same, but refuses anyone who is not an admin.
 *
 * Middleware already guards /admin routes; this exists so that every admin
 * server action and API route re-checks independently. Middleware is
 * convenience, and defence in depth means not relying on it.
 */
export async function requireAdmin(): Promise<Profile> {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/dashboard");
  return profile;
}

/** The profile if signed in, otherwise null. Does not redirect. */
export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return data ?? null;
}
