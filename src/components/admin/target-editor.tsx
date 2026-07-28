"use client";

import { useState, useTransition } from "react";
import { Loader2, Check, X } from "lucide-react";
import { toast } from "sonner";
import {
  setTarget,
  clearMonthlyOverride,
} from "@/app/(app)/admin/targets/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/constants";
import { MONTHS_PER_YEAR } from "@/lib/targets";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export type ConsultantTargets = {
  consultantId: string;
  fullName: string;
  role: string;
  yearlyTarget: number | null;
  monthlyOverrides: { id: string; month: number; grTarget: number }[];
};

function YearlyTargetField({
  consultantId,
  year,
  current,
}: {
  consultantId: string;
  year: number;
  current: number | null;
}) {
  const [value, setValue] = useState(current === null ? "" : String(current));
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("consultantId", consultantId);
      fd.set("year", String(year));
      fd.set("month", "");
      fd.set("grTarget", value === "" ? "" : value);

      const result = await setTarget(fd);
      if (result.ok) toast.success(result.message ?? "Saved.");
      else
        toast.error(
          result.fieldErrors?.grTarget ?? result.message ?? "Could not save.",
        );
    });
  }

  const derived =
    value !== "" && Number.isFinite(Number(value))
      ? Number(value) / MONTHS_PER_YEAR
      : null;

  return (
    <div className="space-y-2">
      <Label htmlFor={`yearly-${consultantId}`}>Yearly GR target ({year})</Label>
      <div className="flex gap-2">
        <Input
          id={`yearly-${consultantId}`}
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="No target set"
          disabled={pending}
          className="tabular-nums"
        />
        <Button type="button" disabled={pending} onClick={save}>
          {pending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Check aria-hidden="true" />
          )}
          Save
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {derived === null
          ? "Leave blank and the dashboard shows “No target set”."
          : `Each month defaults to ${formatCurrency(derived)} unless overridden below.`}
      </p>
    </div>
  );
}

function MonthOverride({
  consultantId,
  year,
  month,
  override,
  fallback,
}: {
  consultantId: string;
  year: number;
  month: number;
  override: { id: string; grTarget: number } | undefined;
  fallback: number | null;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(
    override ? String(override.grTarget) : "",
  );
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("consultantId", consultantId);
      fd.set("year", String(year));
      fd.set("month", String(month));
      fd.set("grTarget", value === "" ? "" : value);

      const result = await setTarget(fd);
      if (result.ok) {
        setEditing(false);
        toast.success(result.message ?? "Saved.");
      } else {
        toast.error(
          result.fieldErrors?.grTarget ?? result.message ?? "Could not save.",
        );
      }
    });
  }

  function clear() {
    if (!override) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", override.id);
      const result = await clearMonthlyOverride(fd);
      if (result.ok) {
        setValue("");
        setEditing(false);
        toast.success(result.message ?? "Removed.");
      } else {
        toast.error(result.message ?? "Could not remove.");
      }
    });
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5 rounded-md border border-border p-2">
        <span className="w-8 shrink-0 text-xs font-medium">
          {MONTH_NAMES[month - 1]}
        </span>
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={pending}
          className="h-9 tabular-nums"
          aria-label={`${MONTH_NAMES[month - 1]} target`}
        />
        <Button type="button" size="icon" variant="ghost" disabled={pending} onClick={save} aria-label="Save">
          {pending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Check aria-hidden="true" />
          )}
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={pending}
          onClick={() => (override ? clear() : setEditing(false))}
          aria-label={override ? "Remove override" : "Cancel"}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-2 text-left transition-colors hover:bg-secondary"
    >
      <span className="text-xs font-medium">{MONTH_NAMES[month - 1]}</span>
      <span className="text-xs tabular-nums text-muted-foreground">
        {override ? (
          <Badge variant="secondary">{formatCurrency(override.grTarget)}</Badge>
        ) : fallback === null ? (
          "—"
        ) : (
          formatCurrency(fallback)
        )}
      </span>
    </button>
  );
}

export function TargetEditor({
  year,
  consultants,
}: {
  year: number;
  consultants: ConsultantTargets[];
}) {
  return (
    <div className="space-y-4">
      {consultants.map((c) => {
        const fallback =
          c.yearlyTarget === null ? null : c.yearlyTarget / MONTHS_PER_YEAR;
        const overrideByMonth = new Map(
          c.monthlyOverrides.map((o) => [o.month, o]),
        );

        return (
          <Card key={c.consultantId}>
            <CardContent className="space-y-4 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-medium">{c.fullName}</h2>
                {c.role === "admin" && <Badge variant="outline">Admin</Badge>}
              </div>

              <YearlyTargetField
                consultantId={c.consultantId}
                year={year}
                current={c.yearlyTarget}
              />

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Monthly overrides
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <MonthOverride
                      key={m}
                      consultantId={c.consultantId}
                      year={year}
                      month={m}
                      override={overrideByMonth.get(m)}
                      fallback={fallback}
                    />
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
