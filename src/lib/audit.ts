import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import type { AuditAction } from "@/lib/constants";

/**
 * Write an audit entry.
 *
 * Uses the caller's own client, so the insert passes through the same RLS
 * policy as everything else: actor_user_id must equal auth.uid(), meaning
 * nobody can attribute an action to someone else.
 *
 * Audit failures are logged but never thrown. Losing an audit row is bad;
 * failing a consultant's submission because the audit insert hiccuped is
 * worse, and the underlying change has already committed by this point.
 */
export async function recordAudit(
  supabase: SupabaseClient<Database>,
  entry: {
    actorUserId: string;
    action: AuditAction;
    entityType: string;
    entityId?: string | null;
    oldValues?: Json | null;
    newValues?: Json | null;
  },
): Promise<void> {
  const { error } = await supabase.from("audit_logs").insert({
    actor_user_id: entry.actorUserId,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    old_values: entry.oldValues ?? null,
    new_values: entry.newValues ?? null,
  });

  if (error) {
    console.error("[audit] failed to record %s: %s", entry.action, error.message);
  }
}

/**
 * Reduce a row to the fields worth keeping in an audit trail.
 * Timestamps and ids are already on the audit row itself.
 */
export function auditSnapshot<T extends Record<string, unknown>>(
  row: T | null | undefined,
  keys: readonly (keyof T)[],
): Json | null {
  if (!row) return null;
  const out: Record<string, unknown> = {};
  for (const key of keys) out[String(key)] = row[key];
  return out as Json;
}
