import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Shared coaching helpers.
 *
 * Kept out of the actions files so the admin side and the consultant side
 * cannot drift on what "upcoming" means or on how a notification is recorded.
 */

/** The columns a consultant is allowed to see. Notes are not among them. */
export const CONSULTANT_SESSION_COLUMNS =
  "id, consultant_id, coach_id, title, category, message, location, requested_topic, agenda, scheduled_at, status, acknowledged_at, cancelled_at, cancellation_reason, created_at";

export type CoachingWithNames = {
  id: string;
  consultant_id: string;
  coach_id: string | null;
  title: string;
  category: string;
  message: string | null;
  location: string | null;
  requested_topic: string | null;
  agenda: string | null;
  scheduled_at: string | null;
  status: string;
  acknowledged_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  consultant_name?: string;
  coach_name?: string | null;
};

/**
 * What the consultant's dashboard shows: their own live coaching.
 *
 * No user filter is applied on purpose. Row Level Security already limits this
 * to the caller's own rows and to the statuses they may see, so a WHERE clause
 * here would only duplicate - and risk contradicting - the policy. The order
 * puts a pending request last, since it has no time to sort by.
 */
export async function fetchMyCoaching(
  supabase: SupabaseClient<Database>,
): Promise<CoachingWithNames[]> {
  const { data, error } = await supabase
    .from("coaching_sessions")
    .select(
      `${CONSULTANT_SESSION_COLUMNS}, coach:profiles!coaching_sessions_coach_id_fkey ( full_name )`,
    )
    .order("scheduled_at", { ascending: true, nullsFirst: false })
    .limit(50);

  if (error) {
    console.error("[coaching] could not read own sessions: %s", error.message);
    throw new Error("Could not read your coaching");
  }

  return ((data ?? []) as unknown as (CoachingWithNames & {
    coach: { full_name: string } | null;
  })[]).map((row) => ({
    ...row,
    coach_name: row.coach?.full_name ?? null,
  }));
}

/**
 * Whether a session is still ahead of the person it is for.
 *
 * A session that started an hour ago is no longer "upcoming" but has not been
 * marked completed either, and showing it as though it were still to come
 * would be wrong. Judged against the start time, since sessions have no end.
 */
export function isUpcoming(
  session: { scheduled_at: string | null; status: string },
  now: Date = new Date(),
): boolean {
  if (session.status !== "scheduled" || !session.scheduled_at) return false;
  return new Date(session.scheduled_at).getTime() >= now.getTime();
}
