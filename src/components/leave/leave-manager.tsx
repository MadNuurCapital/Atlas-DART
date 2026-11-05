"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Plane, Pencil, X, CalendarPlus, Check } from "lucide-react";
import {
  scheduleLeave,
  updateLeave,
  cancelLeave,
  type LeaveActionResult,
} from "@/app/(app)/leave/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  LEAVE_REASONS,
  LEAVE_REASON_LABELS,
  type LeaveReason,
} from "@/lib/constants";
import { addDays, formatSgDate, sgToday } from "@/lib/sg-date";
import type { LeavePeriod } from "@/types/database";

/**
 * Leave & Away Mode.
 *
 * Scheduling leave is three decisions - when it starts, when it ends, why -
 * and the brief for this was explicitly "do not overcomplicate the process".
 * So: no approval step, no half days, no leave-balance arithmetic, and the
 * reason is four buttons rather than a dropdown, because on a phone a tap
 * beats a select.
 *
 * Dates are plain <input type="date">. The native picker is better than
 * anything worth shipping here - it is localised, it is keyboard accessible,
 * and on a phone it is the control people already know. It also keeps the
 * promise not to add libraries for this.
 */

type Group = "active" | "upcoming" | "past";

/** Which bucket a period belongs in, by the Singapore calendar. */
function groupOf(leave: LeavePeriod, today: string): Group {
  if (leave.ends_on < today) return "past";
  if (leave.starts_on > today) return "upcoming";
  return "active";
}

function dayCount(startsOn: string, endsOn: string): number {
  // Both ends inclusive: the 5th to the 5th is one day away, not zero. The
  // database CHECK and away_days() agree with this, and they have to - the
  // number shown here is the number of days that stop counting against you.
  const ms =
    Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${startsOn}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

function describe(leave: LeavePeriod): string {
  const days = dayCount(leave.starts_on, leave.ends_on);
  const span =
    leave.starts_on === leave.ends_on
      ? formatSgDate(leave.starts_on)
      : `${formatSgDate(leave.starts_on)} – ${formatSgDate(leave.ends_on)}`;
  return `${span} · ${days} day${days === 1 ? "" : "s"}`;
}

function ReasonPicker({
  value,
  onChange,
  disabled,
}: {
  value: LeaveReason;
  onChange: (reason: LeaveReason) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Reason"
      className="grid grid-cols-1 gap-2 sm:grid-cols-2"
    >
      {LEAVE_REASONS.map((reason) => {
        const selected = reason === value;
        return (
          <button
            key={reason}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(reason)}
            className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors disabled:opacity-50 ${
              selected
                ? "border-status-away bg-status-away/10 font-medium text-foreground"
                : "border-border hover:bg-secondary"
            }`}
          >
            {LEAVE_REASON_LABELS[reason]}
            {selected && (
              <Check className="size-4 shrink-0 text-status-away" aria-hidden="true" />
            )}
          </button>
        );
      })}
    </div>
  );
}

function LeaveForm({
  existing,
  open,
  onOpenChange,
}: {
  existing?: LeavePeriod | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const today = sgToday();

  const [startsOn, setStartsOn] = useState(existing?.starts_on ?? today);
  const [endsOn, setEndsOn] = useState(existing?.ends_on ?? today);
  const [reason, setReason] = useState<LeaveReason>(
    existing?.reason ?? "holiday",
  );
  const [note, setNote] = useState(existing?.note ?? "");
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [pending, startTransition] = useTransition();

  // Choosing a start after the end is the commonest slip on a two-date form,
  // so the end follows the start rather than waiting to be rejected.
  function pickStart(value: string) {
    setStartsOn(value);
    if (value && endsOn < value) setEndsOn(value);
  }

  const days = startsOn && endsOn && endsOn >= startsOn ? dayCount(startsOn, endsOn) : 0;
  const backdated = Boolean(endsOn) && endsOn < today;

  function submit() {
    startTransition(async () => {
      const fd = new FormData();
      if (existing) fd.set("id", existing.id);
      fd.set("startsOn", startsOn);
      fd.set("endsOn", endsOn);
      fd.set("reason", reason);
      fd.set("note", note);

      const action: (fd: FormData) => Promise<LeaveActionResult> = existing
        ? updateLeave
        : scheduleLeave;
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {existing ? "Edit leave" : "Schedule leave"}
          </DialogTitle>
          <DialogDescription>
            You will not be chased for a DART on these days, and your
            attendance will show as Away rather than absent.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="startsOn">First day away</Label>
              <Input
                id="startsOn"
                type="date"
                value={startsOn}
                onChange={(e) => pickStart(e.target.value)}
                disabled={pending}
                aria-invalid={errors.startsOn ? true : undefined}
              />
              {errors.startsOn && (
                <p className="text-sm text-destructive">{errors.startsOn}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="endsOn">Last day away</Label>
              <Input
                id="endsOn"
                type="date"
                value={endsOn}
                min={startsOn || undefined}
                onChange={(e) => setEndsOn(e.target.value)}
                disabled={pending}
                aria-invalid={errors.endsOn ? true : undefined}
              />
              {errors.endsOn ? (
                <p className="text-sm text-destructive">{errors.endsOn}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Both days included. You are back on{" "}
                  {endsOn ? formatSgDate(addDays(endsOn, 1)) : "the next day"}.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Reason</Label>
            <ReasonPicker value={reason} onChange={setReason} disabled={pending} />
          </div>

          {/* Required for Other, optional otherwise - a reason of "Other"
              with nothing beside it tells an admin nothing at all. */}
          <div className="space-y-2">
            <Label htmlFor="note">
              {reason === "other" ? "What is this for?" : "Note (optional)"}
            </Label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                reason === "other"
                  ? "A few words is plenty"
                  : "Anything your admin should know"
              }
              rows={2}
              disabled={pending}
              aria-invalid={errors.note ? true : undefined}
            />
            {errors.note && (
              <p className="text-sm text-destructive">{errors.note}</p>
            )}
          </div>

          {days > 0 && (
            <div className="rounded-xl border border-border bg-muted px-3 py-2.5 text-sm">
              <p className="font-medium">
                {days} day{days === 1 ? "" : "s"} away
              </p>
              {backdated ? (
                // Said out loud rather than quietly accepted. Backdating is
                // allowed on purpose, but it changes a compliance figure that
                // has already been looked at, and the person doing it should
                // know that is what they are doing.
                <p className="mt-0.5 text-xs text-muted-foreground">
                  These dates have already passed. They will stop counting
                  against your submission record, and the change is recorded
                  against your name.
                </p>
              ) : (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Reminders pause for these days and resume automatically
                  afterwards. You can still submit if you want to.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !startsOn || !endsOn}>
            {pending ? "Saving…" : existing ? "Save changes" : "Schedule leave"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({
  leave,
  open,
  onOpenChange,
}: {
  leave: LeavePeriod | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  const today = sgToday();
  const active = leave ? groupOf(leave, today) === "active" : false;

  function confirm() {
    if (!leave) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", leave.id);
      const result = await cancelLeave(fd);
      onOpenChange(false);
      if (result.ok) toast.success(result.message ?? "Leave cancelled.");
      else toast.error(result.message ?? "Could not cancel that.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {active ? "End Away Mode now?" : "Cancel this leave?"}
          </DialogTitle>
          <DialogDescription>
            {active
              ? // Cancelling leave that is RUNNING has an immediate
                // consequence that cancelling a future booking does not, and
                // conflating the two is how somebody gets chased at 9 PM on
                // the day they thought they were still away.
                "Away Mode is active. Cancelling it puts you back on the normal reminder schedule tonight, and today will count towards your submission record."
              : "This leave has not started yet. Cancelling it means you will be reminded as usual on those days."}
          </DialogDescription>
        </DialogHeader>

        {leave && (
          <p className="text-sm text-muted-foreground">{describe(leave)}</p>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Keep it
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={pending}>
            {pending ? "Cancelling…" : active ? "End Away Mode" : "Cancel leave"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LeaveRow({
  leave,
  group,
  onEdit,
  onCancel,
}: {
  leave: LeavePeriod;
  group: Group;
  onEdit: () => void;
  onCancel: () => void;
}) {
  return (
    <li
      className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-3 ${
        group === "active"
          ? "border-status-away/40 bg-status-away/5"
          : "border-border"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {LEAVE_REASON_LABELS[leave.reason]}
          </span>
          {group === "active" && (
            <Badge variant="away">
              <Plane className="size-3" aria-hidden="true" />
              Away now
            </Badge>
          )}
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {describe(leave)}
        </p>
        {leave.note && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {leave.note}
          </p>
        )}
      </div>

      {/* Finished leave has no buttons. It is a record, and 0034 refuses to
          update it anyway - offering a control the database will reject is
          worse than not offering it. */}
      {group !== "past" && (
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil className="size-4" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">Edit</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <X className="size-4" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">Cancel</span>
          </Button>
        </div>
      )}
    </li>
  );
}

export function LeaveManager({ periods }: { periods: LeavePeriod[] }) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<LeavePeriod | null>(null);
  const [cancelling, setCancelling] = useState<LeavePeriod | null>(null);

  const today = sgToday();

  const groups = useMemo(() => {
    const out: Record<Group, LeavePeriod[]> = {
      active: [],
      upcoming: [],
      past: [],
    };
    for (const leave of periods) out[groupOf(leave, today)].push(leave);
    // Soonest first for what is ahead, most recent first for what is behind.
    out.upcoming.sort((a, b) => a.starts_on.localeCompare(b.starts_on));
    out.past.sort((a, b) => b.ends_on.localeCompare(a.ends_on));
    return out;
  }, [periods, today]);

  const sections: { key: Group; title: string }[] = [
    { key: "active", title: "Away now" },
    { key: "upcoming", title: "Coming up" },
    { key: "past", title: "Previously" },
  ];

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
          <CardTitle className="text-base">Your leave</CardTitle>
          <Button size="sm" onClick={() => setCreating(true)}>
            <CalendarPlus className="size-4" aria-hidden="true" />
            Schedule leave
          </Button>
        </CardHeader>

        <CardContent>
          {periods.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm text-muted-foreground">
                No leave scheduled.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Going away? Add the dates and Atlas DART will stop chasing you
                for those days.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {sections.map(({ key, title }) =>
                groups[key].length === 0 ? null : (
                  <section key={key}>
                    <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {title}
                    </h3>
                    <ul className="space-y-2">
                      {groups[key].map((leave) => (
                        <LeaveRow
                          key={leave.id}
                          leave={leave}
                          group={key}
                          onEdit={() => setEditing(leave)}
                          onCancel={() => setCancelling(leave)}
                        />
                      ))}
                    </ul>
                  </section>
                ),
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Keyed on the row being edited, so opening a second one starts from
          its own values rather than keeping the first one's state. */}
      {creating && (
        <LeaveForm open onOpenChange={(o) => !o && setCreating(false)} />
      )}
      {editing && (
        <LeaveForm
          key={editing.id}
          existing={editing}
          open
          onOpenChange={(o) => !o && setEditing(null)}
        />
      )}
      <CancelDialog
        leave={cancelling}
        open={cancelling !== null}
        onOpenChange={(o) => !o && setCancelling(null)}
      />
    </>
  );
}
