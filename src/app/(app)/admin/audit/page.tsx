import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AuditTrail, type AuditEntry } from "@/components/admin/audit-trail";
import type { AuditLog } from "@/types/database";

export const metadata: Metadata = { title: "Audit trail" };
export const dynamic = "force-dynamic";

const LIMIT = 300;

type AuditJoin = AuditLog & { profiles: { full_name: string } | null };

export default async function AdminAuditPage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data } = await supabase
    .from("audit_logs")
    .select("*, profiles ( full_name )")
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  const entries: AuditEntry[] = ((data as unknown as AuditJoin[]) ?? []).map(
    (row) => ({
      id: row.id,
      actorName: row.profiles?.full_name ?? "Deleted account",
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      oldValues: (row.old_values as Record<string, unknown> | null) ?? null,
      newValues: (row.new_values as Record<string, unknown> | null) ?? null,
      createdAt: row.created_at,
    }),
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Audit trail</h1>
        <p className="text-sm text-muted-foreground">
          The last {LIMIT} changes, newest first.
        </p>
      </div>

      <p className="rounded-md border border-border bg-muted px-3 py-2.5 text-xs text-muted-foreground">
        This trail is append-only. There is no update or delete policy on it for
        any role, including admins, so an entry cannot be altered or removed
        once written. That is what makes an admin editing their own target
        acceptable rather than a hole.
      </p>

      <AuditTrail entries={entries} />
    </div>
  );
}
