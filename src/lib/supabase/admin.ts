import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Service-role Supabase client. BYPASSES Row Level Security entirely.
 *
 * The `server-only` import above makes importing this file from a client
 * component a build error, not a runtime surprise. Use it in exactly two
 * places:
 *
 *   1. The scheduled reminder functions, which run with no user session.
 *   2. Nothing else without a written reason.
 *
 * Anything acting on behalf of a signed-in user must use `lib/supabase/server`
 * so that RLS still applies.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secret) {
    throw new Error(
      "createAdminClient requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY",
    );
  }

  return createSupabaseClient<Database>(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
