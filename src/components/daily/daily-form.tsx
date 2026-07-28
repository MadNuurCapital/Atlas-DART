"use client";

import { useState, useTransition } from "react";
import { Loader2, Save, Send, CircleCheck, CircleAlert } from "lucide-react";
import { toast } from "sonner";
import {
  saveDraft,
  submitDay,
  type ActionResult,
} from "@/app/(app)/today/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CAMPAIGN_STATUSES,
  CAMPAIGN_STATUS_LABELS,
  DEADLINE_LABEL,
  type CampaignStatus,
} from "@/lib/constants";
import { formatSgDateTime } from "@/lib/sg-date";
import type { DailySubmission } from "@/types/database";

type Errors = Record<string, string | undefined>;

/**
 * The daily DART form.
 *
 * Designed to be finished in under two minutes on a phone: one column, every
 * control at least 44px, numeric fields opening a numeric keypad.
 *
 * All fields are controlled state rather than read from the DOM, because the
 * confirmation dialog is rendered in a portal outside this form and needs the
 * current values. Reading them back out of a ref at render time would be a
 * React violation and, worse, could submit stale numbers.
 */
export function DailyForm({
  businessDate,
  submission,
  readOnly,
  readOnlyReason,
}: {
  businessDate: string;
  submission: DailySubmission | null;
  readOnly: boolean;
  readOnlyReason?: string;
}) {
  const [dials, setDials] = useState(String(submission?.dials ?? 0));
  const [talkedTo, setTalkedTo] = useState(String(submission?.talked_to ?? 0));
  const [campaignStatus, setCampaignStatus] = useState<CampaignStatus>(
    submission?.campaign_status ?? "running",
  );
  const [inOffice, setInOffice] = useState(submission?.in_office ?? true);
  const [notes, setNotes] = useState(submission?.notes ?? "");

  const [errors, setErrors] = useState<Errors>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const isSubmitted = submission?.status === "submitted";

  function buildFormData(): FormData {
    const fd = new FormData();
    fd.set("businessDate", businessDate);
    fd.set("dials", dials.trim() === "" ? "" : dials);
    fd.set("talkedTo", talkedTo.trim() === "" ? "" : talkedTo);
    fd.set("campaignStatus", campaignStatus);
    fd.set("inOffice", String(inOffice));
    fd.set("notes", notes);
    return fd;
  }

  function run(action: (fd: FormData) => Promise<ActionResult>) {
    // The transition keeps the buttons disabled for the whole round trip, so a
    // second tap cannot fire a second request. The database upsert makes that
    // harmless anyway - this is just so nothing looks like it did nothing.
    startTransition(async () => {
      const result = await action(buildFormData());
      setErrors(result.fieldErrors ?? {});

      if (result.ok) {
        setConfirmOpen(false);
        if (result.message) toast.success(result.message);
      } else if (result.message) {
        toast.error(result.message);
      } else if (result.fieldErrors) {
        setConfirmOpen(false);
        toast.error("Please check the highlighted fields.");
      }
    });
  }

  return (
    <>
      <div className="space-y-5">
        {readOnly && readOnlyReason && (
          <div
            role="status"
            className="flex items-start gap-2 rounded-md border border-border bg-muted px-3 py-2.5 text-sm text-muted-foreground"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{readOnlyReason}</span>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="dials">Dials (D)</Label>
            <Input
              id="dials"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={dials}
              onChange={(e) => setDials(e.target.value)}
              disabled={readOnly || pending}
              className="text-lg font-semibold tabular-nums"
              aria-invalid={errors.dials ? true : undefined}
              aria-describedby="dials-hint"
            />
            <p id="dials-hint" className="text-xs text-muted-foreground">
              Outbound calls attempted
            </p>
            {errors.dials && (
              <p className="text-sm text-destructive">{errors.dials}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="talkedTo">Talked To (TT)</Label>
            <Input
              id="talkedTo"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={talkedTo}
              onChange={(e) => setTalkedTo(e.target.value)}
              disabled={readOnly || pending}
              className="text-lg font-semibold tabular-nums"
              aria-invalid={errors.talkedTo ? true : undefined}
              aria-describedby="talkedTo-hint"
            />
            <p id="talkedTo-hint" className="text-xs text-muted-foreground">
              Meaningful conversations
            </p>
            {errors.talkedTo && (
              <p className="text-sm text-destructive">{errors.talkedTo}</p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="campaign">Campaign status (C)</Label>
          <Select
            value={campaignStatus}
            onValueChange={(v) => setCampaignStatus(v as CampaignStatus)}
            disabled={readOnly || pending}
          >
            <SelectTrigger id="campaign">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CAMPAIGN_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {CAMPAIGN_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.campaignStatus && (
            <p className="text-sm text-destructive">{errors.campaignStatus}</p>
          )}
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border bg-background px-4 py-3">
          <div>
            <Label htmlFor="office" className="text-base">
              In the office (O)
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {inOffice ? "Green on the team board" : "Red on the team board"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              data-testid="office-indicator"
              className={`size-4 rounded-full ${
                inOffice ? "bg-status-present" : "bg-status-absent"
              }`}
            />
            <Switch
              id="office"
              checked={inOffice}
              onCheckedChange={setInOffice}
              disabled={readOnly || pending}
              aria-label="In the office"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="notes">Notes (optional)</Label>
          <Textarea
            id="notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={readOnly || pending}
            placeholder="Anything management should know about today"
          />
        </div>

        {!readOnly && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="flex-1"
              disabled={pending}
              data-testid="save-draft"
              onClick={() => run(saveDraft)}
            >
              {pending ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Save aria-hidden="true" />
              )}
              Save draft
            </Button>

            <Button
              type="button"
              size="lg"
              className="flex-1"
              disabled={pending}
              data-testid="open-submit"
              onClick={() => setConfirmOpen(true)}
            >
              <Send aria-hidden="true" />
              {isSubmitted ? "Resubmit" : "Submit"}
            </Button>
          </div>
        )}

        {submission && (
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
            {isSubmitted ? (
              <Badge variant="success">
                <CircleCheck className="size-3" aria-hidden="true" />
                Submitted
              </Badge>
            ) : (
              <Badge variant="muted">Draft — not submitted</Badge>
            )}
            {submission.first_submitted_at && (
              <span>
                First submitted{" "}
                {formatSgDateTime(submission.first_submitted_at)}
              </span>
            )}
            {submission.revision_count > 0 && (
              <span>
                · {submission.revision_count} revision
                {submission.revision_count === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isSubmitted ? "Resubmit this day?" : "Submit this day?"}
            </DialogTitle>
            <DialogDescription>
              {isSubmitted
                ? "Your original submission time stays as it is, so an on-time submission remains on time. The revision will be recorded."
                : `Submissions for this date close at ${DEADLINE_LABEL} Singapore time. You can still correct this afterwards.`}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg bg-secondary px-3 py-2.5 text-sm tabular-nums text-secondary-foreground">
            D {dials || 0} · TT {talkedTo || 0} ·{" "}
            {CAMPAIGN_STATUS_LABELS[campaignStatus]} ·{" "}
            {inOffice ? "In office" : "Not in office"}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => setConfirmOpen(false)}
            >
              Not yet
            </Button>
            <Button
              type="button"
              disabled={pending}
              data-testid="confirm-submit"
              onClick={() => run(submitDay)}
            >
              {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
              {isSubmitted ? "Yes, resubmit" : "Yes, submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
