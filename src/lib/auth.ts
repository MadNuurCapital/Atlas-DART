import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nagBusinessDate } from "@/lib/nag";
import type { Profile } from "@/types/database";
import type { SubmissionStatus } from "@/lib/constants";

/** What the shell needs before it can draw anything. */
type Bootstrap = {
  profile: Profile | null;
  /** The day being chased, or null if nothing is recorded for it yet. */
  nagStatus: SubmissionStatus | null;
};

/**
 * Who is asking.
 *
 * Every one of these is wrapped in React's cache(), which deduplicates calls
 * within a single request's render pass. That matters far more than it looks:
 * a page like /admin/daily asks three times over - once in the app layout,
 * once in the admin layout, once in the page itself - and each ask was
 * previously a full round trip to Supabase Auth plus a profiles SELECT. Six
 * network hops to answer one question.
 *
 * With cache() the first call pays, the rest are free, and the answer is
 * guaranteed consistent across the whole render rather than three separate
 * lookups that could in principle disagree.
 *
 * The cache lives for one request only. A Server Action is a separate request
 * and gets a fresh, revalidated answer.
 */

const loadBootstrap = cache(async (): Promise<Bootstrap> => {
  const supabase = await createClient();

  // getClaims() verifies the access token's signature before returning
  // anything, so the id below is as trustworthy as getUser()'s - but on a
  // project using asymmetric signing keys it does that verification locally
  // with WebCrypto instead of asking the Auth server, which removes a round
  // trip from the front of every single page load. On a project still using
  // the legacy shared secret it transparently falls back to asking the
  // server, so this is never worse than what it replaces.
  //
  // What it is emphatically NOT is getSession(), which decodes the cookie
  // without checking the signature and would trust anything the browser sent.
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;

  if (!userId) return { profile: null, nagStatus: null };

  // One call for both answers the shell needs.
  //
  // These used to be two queries - a profiles SELECT here, and a
  // daily_submissions lookup in the layout - and the layout renders on EVERY
  // page. At ~330ms a trip between US East and Singapore, that second question
  // was costing a third of a second on every navigation in the app.
  //
  // The nag date is computed here rather than in SQL because the rule (it
  // means YESTERDAY between midnight and 6am) already lives in lib/nag.ts, and
  // a second implementation in Postgres would eventually disagree with it.
  const { data: payload, error } = await supabase.rpc("app_bootstrap", {
    p_nag_date: nagBusinessDate(),
  });

  if (error || !payload) {
    // Deliberately not a throw. A failed read here means we cannot establish
    // who is asking, and the only safe response to that is the login screen -
    // which is what a null profile already produces. Throwing would replace a
    // clean redirect with an error page on every route in the app.
    console.error("[auth] app_bootstrap failed: %s", error?.message);
    return { profile: null, nagStatus: null };
  }

  return {
    profile: payload.profile,
    nagStatus: payload.nag_status,
  };
});

/**
 * The signed-in user's profile, or a redirect to login.
 *
 * Every server component and server action that needs to know who is asking
 * should go through here rather than reading the session directly, so the
 * "authenticated but no profile row" case is handled in exactly one place.
 */
export async function requireProfile(): Promise<Profile> {
  const { profile } = await loadBootstrap();

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
  return (await loadBootstrap()).profile;
}

/**
 * Whether the day currently being chased has been submitted.
 *
 * Shares the cached bootstrap call with requireProfile(), so the layout gets
 * this for free rather than paying a second round trip for it. Null means
 * nothing is recorded for that day at all, which the banner treats the same as
 * a draft: not submitted.
 */
export async function getNagStatus(): Promise<SubmissionStatus | null> {
  return (await loadBootstrap()).nagStatus;
}
