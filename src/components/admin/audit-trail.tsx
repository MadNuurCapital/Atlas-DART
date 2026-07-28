"use client";

import { useMemo, useState } from "react";
import { Search, ArrowRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AUDIT_ACTION_LABELS, formatCurrency } from "@/lib/constants";
import { formatSgDateTime } from "@/lib/sg-date";

export type AuditEntry = {
  id: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  createdAt: string;
};

const MONEY_FIELDS = new Set(["gr_target", "gr_amount", "ape_amount"]);

const FIELD_LABELS: Record<string, string> = {
  gr_target: "Target",
  gr_amount: "GR",
  ape_amount: "APE",
  client_name: "Client",
  policy_name: "Policy",
  policy_type: "Category",
  date_submitted: "Date submitted",
  date_incepted: "Date incepted",
  cancellation_reason: "Reason",
  campaign_status: "Campaign",
  in_office: "In office",
  talked_to: "Talked to",
  full_name: "Name",
  status: "Status",
  role: "Role",
  active: "Active",
  dials: "Dials",
  notes: "Notes",
  month: "Month",
  year: "Year",
  name: "Name",
  email: "Email",
  method: "Method",
};

function present(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (MONEY_FIELDS.has(field) && typeof value === "number") {
    return formatCurrency(value);
  }
  if (MONEY_FIELDS.has(field) && typeof value === "string" && !isNaN(Number(value))) {
    return formatCurrency(Number(value));
  }
  return String(value);
}

/**
 * What actually changed between the two snapshots.
 *
 * Only fields that moved are shown. An audit entry listing every column is
 * technically complete and practically unreadable - the question being asked
 * is always "what did they change", not "what did the row look like".
 */
function diff(
  oldValues: Record<string, unknown> | null,
  newValues: Record<string, unknown> | null,
): { field: string; from: string; to: string }[] {
  if (!newValues) return [];

  const keys = new Set([
    ...Object.keys(oldValues ?? {}),
    ...Object.keys(newValues),
  ]);

  const changes: { field: string; from: string; to: string }[] = [];

  for (const key of keys) {
    const before = oldValues?.[key];
    const after = newValues[key];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;

    changes.push({
      field: FIELD_LABELS[key] ?? key.replace(/_/g, " "),
      from: present(key, before),
      to: present(key, after),
    });
  }

  return changes;
}

function EntryCard({ entry }: { entry: AuditEntry }) {
  const changes = diff(entry.oldValues, entry.newValues);
  const isCreation = !entry.oldValues;

  return (
    <li>
      <Card>
        <CardContent className="space-y-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{entry.actorName}</span>
              <Badge variant="secondary">
                {AUDIT_ACTION_LABELS[entry.action] ??
                  entry.action.replace(/_/g, " ")}
              </Badge>
            </div>
            <span className="text-xs text-muted-foreground">
              {formatSgDateTime(entry.createdAt)}
            </span>
          </div>

          {changes.length > 0 && (
            <ul className="space-y-1 text-xs">
              {changes.map((c) => (
                <li key={c.field} className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium capitalize">{c.field}</span>
                  {isCreation ? (
                    <span className="tabular-nums">{c.to}</span>
                  ) : (
                    <>
                      <span className="text-muted-foreground line-through tabular-nums">
                        {c.from}
                      </span>
                      <ArrowRight
                        className="size-3 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="font-medium tabular-nums">{c.to}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </li>
  );
}

/**
 * The audit trail.
 *
 * Written to on every mutation since Phase 2, but until now there was no way
 * to read it without a database console. A trail nobody can see is only half
 * a control - the point of "an admin may edit their own target" being
 * acceptable is that somebody can check.
 */
export function AuditTrail({ entries }: { entries: AuditEntry[] }) {
  const [query, setQuery] = useState("");
  const [action, setAction] = useState<string>("all");

  const actions = useMemo(
    () => [...new Set(entries.map((e) => e.action))].sort(),
    [entries],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (action !== "all" && e.action !== action) return false;
      if (!q) return true;
      return (
        e.actorName.toLowerCase().includes(q) ||
        JSON.stringify(e.newValues ?? {}).toLowerCase().includes(q) ||
        JSON.stringify(e.oldValues ?? {}).toLowerCase().includes(q)
      );
    });
  }, [entries, query, action]);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by person or value"
          className="pl-9"
          aria-label="Search the audit trail"
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          size="sm"
          variant={action === "all" ? "secondary" : "ghost"}
          onClick={() => setAction("all")}
        >
          Everything
        </Button>
        {actions.map((a) => (
          <Button
            key={a}
            type="button"
            size="sm"
            variant={action === a ? "secondary" : "ghost"}
            onClick={() => setAction(a)}
          >
            {AUDIT_ACTION_LABELS[a] ?? a.replace(/_/g, " ")}
          </Button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="pt-5 text-center text-sm text-muted-foreground">
            {entries.length === 0
              ? "Nothing recorded yet."
              : "Nothing matches those filters."}
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2" data-testid="audit-entries">
          {filtered.map((e) => (
            <EntryCard key={e.id} entry={e} />
          ))}
        </ul>
      )}
    </div>
  );
}
