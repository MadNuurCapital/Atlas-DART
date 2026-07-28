"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, Check } from "lucide-react";
import { toast } from "sonner";
import {
  createCase,
  updateCase,
  createInsurer,
  type CaseActionResult,
} from "@/app/(app)/cases/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { POLICY_TYPES, type PolicyType } from "@/lib/constants";
import { sgToday } from "@/lib/sg-date";
import type { Case, Insurer } from "@/types/database";

type Errors = Record<string, string | undefined>;

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

export function CaseForm({
  insurers,
  existing,
  open,
  onOpenChange,
}: {
  insurers: Insurer[];
  existing?: Case | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [dateSubmitted, setDateSubmitted] = useState(
    existing?.date_submitted ?? sgToday(),
  );
  const [dateIncepted, setDateIncepted] = useState(existing?.date_incepted ?? "");
  const [clientName, setClientName] = useState(existing?.client_name ?? "");
  const [insurerId, setInsurerId] = useState(existing?.insurer_id ?? "");
  const [policyName, setPolicyName] = useState(existing?.policy_name ?? "");
  const [policyType, setPolicyType] = useState<PolicyType>(
    existing?.policy_type ?? "Term",
  );
  const [ape, setApe] = useState(String(existing?.ape_amount ?? ""));
  const [gr, setGr] = useState(String(existing?.gr_amount ?? ""));

  const [newInsurer, setNewInsurer] = useState("");
  const [addingInsurer, setAddingInsurer] = useState(false);

  const [errors, setErrors] = useState<Errors>({});
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const fd = new FormData();
      if (existing) fd.set("id", existing.id);
      fd.set("dateSubmitted", dateSubmitted);
      fd.set("dateIncepted", dateIncepted);
      fd.set("clientName", clientName);
      fd.set("insurerId", insurerId);
      fd.set("policyName", policyName);
      fd.set("policyType", policyType);
      fd.set("apeAmount", ape === "" ? "" : ape);
      fd.set("grAmount", gr === "" ? "" : gr);

      const action: (fd: FormData) => Promise<CaseActionResult> = existing
        ? updateCase
        : createCase;
      const result = await action(fd);

      setErrors(result.fieldErrors ?? {});
      if (result.ok) {
        onOpenChange(false);
        if (result.message) toast.success(result.message);
      } else if (result.message) {
        toast.error(result.message);
      } else {
        toast.error("Please check the highlighted fields.");
      }
    });
  }

  function addInsurer() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("name", newInsurer);
      const result = await createInsurer(fd);

      if (result.ok && result.insurerId) {
        setInsurerId(result.insurerId);
        setNewInsurer("");
        setAddingInsurer(false);
        if (result.message) toast.success(result.message);
      } else {
        toast.error(
          result.fieldErrors?.name ??
            result.message ??
            "That insurer could not be added.",
        );
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit case" : "Add signed case"}</DialogTitle>
          <DialogDescription>
            GR counts toward the month the case was <strong>submitted</strong>.
            Leave the inception date blank until the policy goes live.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field
            id="clientName"
            label="Client name"
            error={errors.clientName}
          >
            <Input
              id="clientName"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Who signed?"
              autoComplete="off"
              disabled={pending}
              aria-invalid={errors.clientName ? true : undefined}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="dateSubmitted"
              label="Date submitted"
              hint="Drives GR and the reporting month"
              error={errors.dateSubmitted}
            >
              <Input
                id="dateSubmitted"
                type="date"
                value={dateSubmitted}
                onChange={(e) => setDateSubmitted(e.target.value)}
                disabled={pending}
                aria-invalid={errors.dateSubmitted ? true : undefined}
              />
            </Field>

            <Field
              id="dateIncepted"
              label="Date incepted"
              hint="Optional — blank means pending inception"
              error={errors.dateIncepted}
            >
              <Input
                id="dateIncepted"
                type="date"
                value={dateIncepted}
                onChange={(e) => setDateIncepted(e.target.value)}
                disabled={pending}
                aria-invalid={errors.dateIncepted ? true : undefined}
              />
            </Field>
          </div>

          <Field id="insurerId" label="Insurer" error={errors.insurerId}>
            {addingInsurer ? (
              <div className="flex gap-2">
                <Input
                  id="insurerId"
                  value={newInsurer}
                  onChange={(e) => setNewInsurer(e.target.value)}
                  placeholder="New insurer name"
                  disabled={pending}
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending || newInsurer.trim().length < 2}
                  onClick={addInsurer}
                >
                  {pending ? (
                    <Loader2 className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Check aria-hidden="true" />
                  )}
                  Add
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Select
                  value={insurerId}
                  onValueChange={setInsurerId}
                  disabled={pending}
                >
                  <SelectTrigger id="insurerId" className="flex-1">
                    <SelectValue placeholder="Choose an insurer" />
                  </SelectTrigger>
                  <SelectContent>
                    {insurers.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Add a new insurer"
                  disabled={pending}
                  onClick={() => setAddingInsurer(true)}
                >
                  <Plus aria-hidden="true" />
                </Button>
              </div>
            )}
          </Field>

          <Field id="policyName" label="Policy name" error={errors.policyName}>
            <Input
              id="policyName"
              value={policyName}
              onChange={(e) => setPolicyName(e.target.value)}
              placeholder="Product name as written"
              autoComplete="off"
              disabled={pending}
              aria-invalid={errors.policyName ? true : undefined}
            />
          </Field>

          <Field id="policyType" label="Policy type" error={errors.policyType}>
            <Select
              value={policyType}
              onValueChange={(v) => setPolicyType(v as PolicyType)}
              disabled={pending}
            >
              <SelectTrigger id="policyType">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POLICY_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="apeAmount" label="APE (S$)" error={errors.apeAmount}>
              <Input
                id="apeAmount"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={ape}
                onChange={(e) => setApe(e.target.value)}
                placeholder="0.00"
                disabled={pending}
                className="tabular-nums"
                aria-invalid={errors.apeAmount ? true : undefined}
              />
            </Field>

            <Field id="grAmount" label="GR (S$)" error={errors.grAmount}>
              <Input
                id="grAmount"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={gr}
                onChange={(e) => setGr(e.target.value)}
                placeholder="0.00"
                disabled={pending}
                className="tabular-nums"
                aria-invalid={errors.grAmount ? true : undefined}
              />
            </Field>
          </div>

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={pending}
              data-testid="save-case"
              onClick={submit}
            >
              {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
              {existing ? "Save changes" : "Add case"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
