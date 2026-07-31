import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "@/lib/query";
import { CoachingManager } from "@/components/admin/coaching-manager";
import type { AdminCoachingRow } from "@/components/admin/coaching-manager";

export const metadata: Metadata = { title: "Coaching" };
export const dynamic = "force-dynamic";

/**
 * Every session, for both admins.
 *
 * Deliberately not filtered to the signed-in admin's own bookings: decided
 * during discovery, so that a request always reaches somebody and nothing is
 * orphaned when one admin is away or leaves.
 */
export default async function AdminCoachingPage() {
  await requireAdmin();
  const supabase = await createClient();

  const [sessionsRes, peopleRes, notesRes] = await Promise.all([
    supabase
      .from("coaching_sessions")
      .select(
        `*,
         consultant:profiles!coaching_sessions_consultant_id_fkey ( full_name ),
         coach:profiles!coaching_sessions_coach_id_fkey ( full_name )`,
      )
      .order("scheduled_at", { ascending: false, nullsFirst: true })
      .limit(500),
    supabase
      .from("profiles")
      .select("id, full_name, role, active")
      .eq("active", true)
      .order("full_name", { ascending: true }),
    supabase.from("coaching_notes").select("*"),
  ]);

  const sessions = unwrap(sessionsRes, "coaching sessions");
  const people = unwrap(peopleRes, "the team");
  const notes = unwrap(notesRes, "coaching notes");

  const notesBySession = new Map(
    ((notes ?? []) as { session_id: string; internal_notes: string | null; outcome_notes: string | null }[]).map(
      (n) => [n.session_id, n],
    ),
  );

  const rows: AdminCoachingRow[] = (
    (sessions ?? []) as unknown as (AdminCoachingRow & {
      consultant: { full_name: string } | null;
      coach: { full_name: string } | null;
    })[]
  ).map((row) => ({
    ...row,
    consultant_name: row.consultant?.full_name ?? "Unknown",
    coach_name: row.coach?.full_name ?? null,
    internal_notes: notesBySession.get(row.id)?.internal_notes ?? null,
    outcome_notes: notesBySession.get(row.id)?.outcome_notes ?? null,
  }));

  const team = ((people ?? []) as { id: string; full_name: string; role: string }[]).map(
    (p) => ({ id: p.id, fullName: p.full_name, role: p.role }),
  );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Coaching</h1>
        <p className="text-sm text-muted-foreground">
          Private one-to-one sessions. Only the person a session is for can see
          it, and your notes are never visible to them.
        </p>
      </div>

      <CoachingManager rows={rows} team={team} />
    </div>
  );
}
