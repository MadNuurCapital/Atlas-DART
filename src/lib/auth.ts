import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/database";

/**
 * Who is asking.
 *
 * Every one of these is wrapped in React's cache(), which deduplicates calls
 * within a single request's render pass. That matters far more than it looks:
 * a page like /admin/daily asks three times over - once in the app layout,
 * once in the admin layout, once in the page itself - and each ask was
 * previously a full getUser() round trip to Supabase Auth plus a profiles
 * SELECT. Six network hops to answer one question.
 *
 * With cache() the first call pays, the rest are free, and the answer is
 * guaranteed consistent across the whole render rather than three separate
 * lookups that could in principle disagree.
 *
 * The cache lives for one request only. A Server Action is a separate request
 * and gets a fresh, revalidated answer.
 */

const loadProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();

  // getUser() revalidates against the Auth server rather than trusting a
  // cookie the browser could have tampered with. It is the expensive call,
  // which is exactly why it is behind cache().
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
});

/**
 * The signed-in user's profile, or a redirect to login.
 *
 * Every server component and server action that needs to know who is asking
 * should go through here rather than reading the session directly, so the
 * "authenticated but no profile row" case is handled in exactly one place.
 */
export async function requireProfile(): Promise<Profile> {
  const profile = await loadProfile();

  if (!profile) {
    // Either no session, or authenticated with no profile row. The second
    // should be impossible - the on_auth_user_created trigger creates one -
    // but signing them out is the only safe response, since we cannot
    // establish their role.
    redirect("/login");
  }

  return profile;
}

/**
 * Same, but refuses anyone who is not an admin.
 *
 * Middleware already keeps non-admins away from /admin, and Row Level Security
 * means an admin page would return nothing useful to a consultant anyway. This
 * exists so that none of those three has to be perfect on its own.
 */
export async function requireAdmin(): Promise<Profile> {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/dashboard");
  return profile;
}

/** The profile if signed in, otherwise null. Does not redirect. */
export async function getProfile(): Promise<Profile | null> {
  return loadProfile();
}
