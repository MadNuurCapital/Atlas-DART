"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Loader2,
  Plus,
  Pencil,
  Ban,
  RotateCcw,
  Search,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { cancelCase, restoreCase } from "@/app/(app)/cases/actions";
import { CaseForm } from "@/components/cases/case-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/constants";
import { formatSgDate } from "@/lib/sg-date";
import type { Case, Insurer } from "@/types/database";

export type CaseWithInsurer = Case & {
  insurer_name: string;
  consultant_name?: string;
};

function CancelDialog({
  target,
  onDone,
  onOpenChange,
}: {
  target: CaseWithInsurer | null;
  onDone: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function confirm() {
    if (!target) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("caseId", target.id);
      fd.set("reason", reason);

      const result = await cancelCase(fd);
      if (result.ok) {
        setReason("");
        setError(undefined);
        onDone();
        if (result.message) toast.success(result.message);
      } else {
        setError(result.fieldErrors?.reason);
        if (result.message) toast.error(result.message);
      }
    });
  }

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel and remove from totals</DialogTitle>
          <DialogDescription>
            {target && (
              <>
                <strong>{target.client_name}</strong> ·{" "}
                {formatCurrency(target.gr_amount)} GR. This stops counting
                immediately, including in the month it was submitted. The record
                is kept, so it can be restored by an admin if this is a mistake.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="reason">Reason (required)</Label>
          <Textarea
            id="reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this case being removed?"
            disabled={pending}
            aria-invalid={error ? true : undefined}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Keep it
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            data-testid="confirm-cancel-case"
            onClick={confirm}
          >
            {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
            Cancel and remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CaseCard({
  row,
  insurers,
  isAdmin,
  showConsultant,
  onCancel,
}: {
  row: CaseWithInsurer;
  insurers: Insurer[];
  isAdmin: boolean;
  showConsultant: boolean;
  onCancel: (row: CaseWithInsurer) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const cancelled = row.status === "cancelled";

  function restore() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("caseId", row.id);
      const result = await restoreCase(fd);
      if (result.message) {
        if (result.ok) toast.success(result.message);
        else toast.error(result.message);
      }
    });
  }

  return (
    <>
      <Card className={cancelled ? "opacity-70" : undefined}>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{row.client_name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {row.insurer_name} · {row.policy_name}
                {showConsultant && row.consultant_name
                  ? ` · ${row.consultant_name}`
                  : ""}
              </p>
            </div>
            <Badge variant={cancelled ? "danger" : "secondary"}>
              {cancelled ? "Cancelled" : row.policy_type}
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm tabular-nums">
            <span>
              <span className="text-muted-foreground">APE </span>
              {formatCurrency(row.ape_amount)}
            </span>
            <span>
              <span className="text-muted-foreground">GR </span>
              <span className={cancelled ? "line-through" : "font-medium"}>
                {formatCurrency(row.gr_amount)}
              </span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Submitted {formatSgDate(row.date_submitted)}</span>
            {row.date_incepted ? (
              <span>· Incepted {formatSgDate(row.date_incepted)}</span>
            ) : (
              !cancelled && (
                <Badge variant="warning">
                  <Clock className="size-3" aria-hidden="true" />
                  Pending inception
                </Badge>
              )
            )}
          </div>

          {cancelled && row.cancellation_reason && (
            <p className="rounded-md bg-muted px-2.5 py-2 text-xs text-muted-foreground">
              <strong>Reason:</strong> {row.cancellation_reason}
              {row.cancelled_at && ` · ${formatSgDate(row.cancelled_at.slice(0, 10))}`}
            </p>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            {!cancelled && (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing(true)}
                >
                  <Pencil aria-hidden="true" />
                  Edit
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => onCancel(row)}
                >
                  <Ban aria-hidden="true" />
                  Cancel and remove
                </Button>
              </>
            )}

            {cancelled && isAdmin && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={restore}
              >
                {pending ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <RotateCcw aria-hidden="true" />
                )}
                Restore
              </Button>
            )}

            {cancelled && !isAdmin && (
              <p className="text-xs text-muted-foreground">
                Only an admin can restore a cancelled case.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {editing && (
        <CaseForm
          insurers={insurers}
          existing={row}
          open={editing}
          onOpenChange={setEditing}
        />
      )}
    </>
  );
}

/**
 * Case list with search, month filter and the active/cancelled split.
 *
 * Filtering happens on data the server already scoped by RLS, so a consultant
 * can only ever search their own book.
 */
export function CaseList({
  cases,
  insurers,
  isAdmin,
  showConsultant = false,
  canAdd = true,
}: {
  cases: CaseWithInsurer[];
  insurers: Insurer[];
  isAdmin: boolean;
  showConsultant?: boolean;
  canAdd?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [month, setMonth] = useState("");
  const [showCancelled, setShowCancelled] = useState(false);
  const [adding, setAdding] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<CaseWithInsurer | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cases.filter((c) => {
      if (showCancelled !== (c.status === "cancelled")) return false;
      if (month && !c.date_submitted.startsWith(month)) return false;
      if (!q) return true;
      return (
        c.client_name.toLowerCase().includes(q) ||
        c.policy_name.toLowerCase().includes(q) ||
        c.insurer_name.toLowerCase().includes(q) ||
        (c.consultant_name?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [cases, query, month, showCancelled]);

  const activeCount = cases.filter((c) => c.status === "active").length;
  const cancelledCount = cases.length - activeCount;

  const totalGr = filtered
    .filter((c) => c.status === "active")
    .reduce((sum, c) => sum + Number(c.gr_amount), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search client, policy or insurer"
            className="pl-9"
            aria-label="Search cases"
          />
        </div>
        <Input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="w-auto"
          aria-label="Filter by month"
        />
        {canAdd && (
          <Button type="button" onClick={() => setAdding(true)} data-testid="add-case">
            <Plus aria-hidden="true" />
            Add case
          </Button>
        )}
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={showCancelled ? "ghost" : "secondary"}
          onClick={() => setShowCancelled(false)}
        >
          Active ({activeCount})
        </Button>
        <Button
          type="button"
          size="sm"
          variant={showCancelled ? "secondary" : "ghost"}
          onClick={() => setShowCancelled(true)}
        >
          Cancelled ({cancelledCount})
        </Button>
      </div>

      {!showCancelled && filtered.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {filtered.length} case{filtered.length === 1 ? "" : "s"} ·{" "}
          <span className="font-medium text-foreground tabular-nums">
            {formatCurrency(totalGr)}
          </span>{" "}
          active GR
        </p>
      )}

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="pt-5 text-center text-sm text-muted-foreground">
            {cases.length === 0
              ? "No cases recorded yet."
              : "Nothing matches those filters."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((row) => (
            <CaseCard
              key={row.id}
              row={row}
              insurers={insurers}
              isAdmin={isAdmin}
              showConsultant={showConsultant}
              onCancel={setCancelTarget}
            />
          ))}
        </div>
      )}

      {adding && (
        <CaseForm insurers={insurers} open={adding} onOpenChange={setAdding} />
      )}

      <CancelDialog
        target={cancelTarget}
        onDone={() => setCancelTarget(null)}
        onOpenChange={(open) => !open && setCancelTarget(null)}
      />
    </div>
  );
}
