import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { UserManager, type ManagedUser } from "@/components/admin/user-manager";
import type { Profile } from "@/types/database";

export const metadata: Metadata = { title: "People" };
export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  await requireAdmin();
  const supabase = await createClient();

  const [{ data: profiles }, { data: submissions }] = await Promise.all([
    supabase.from("profiles").select("*").order("full_name", { ascending: true }),
    supabase
      .from("daily_submissions")
      .select("user_id, business_date")
      .eq("status", "submitted")
      .order("business_date", { ascending: false }),
  ]);

  // First row per user wins, because the query is already sorted newest-first.
  const lastSubmission = new Map<string, string>();
  for (const row of (submissions as { user_id: string; business_date: string }[]) ??
    []) {
    if (!lastSubmission.has(row.user_id)) {
      lastSubmission.set(row.user_id, row.business_date);
    }
  }

  const users: ManagedUser[] = ((profiles as Profile[]) ?? []).map((p) => ({
    id: p.id,
    fullName: p.full_name,
    email: p.email,
    role: p.role,
    active: p.active,
    lastSubmission: lastSubmission.get(p.id) ?? null,
  }));

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">People</h1>
        <p className="text-sm text-muted-foreground">
          Invite consultants and admins, change roles, and deactivate leavers.
        </p>
      </div>

      <p className="rounded-md border border-border bg-muted px-3 py-2.5 text-xs text-muted-foreground">
        Deactivating stops someone&rsquo;s reminders and removes them from
        missing lists and compliance, while every figure they produced stays
        exactly where it is in past reports. It is never a delete. Every change
        on this page is written to the audit trail.
      </p>

      <UserManager users={users} />
    </div>
  );
}
