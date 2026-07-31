"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Ban,
  Check,
  CircleCheck,
  Clock,
  Loader2,
  NotebookPen,
  Plus,
  RotateCcw,
  Search,
  UserX,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  cancelCoaching,
  createCoachingBulk,
  saveCoachingNotes,
  scheduleCoaching,
  setCoachingOutcome,
} from "@/app/(app)/admin/coaching/actions";
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
import {
  COACHING_CATEGORIES,
  COACHING_CATEGORY_LABELS,
  COACHING_STATUS_LABELS,
  type CoachingCategory,
  type CoachingStatus,
} from "@/lib/constants";
import { formatSgDateTime, sgToday } from "@/lib/sg-date";

export type AdminCoachingRow = {
  id: string;
  consultant_id: string;
  coach_id: string | null;
  title: string;
  category: string;
  message: string | null;
  location: string | null;
  requested_topic: string | null;
  agenda: string | null;
  scheduled_at: string | null;
  status: string;
  acknowledged_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  consultant_name: string;
  coach_name: string | null;
  internal_notes: string | null;
  outcome_notes: string | null;
};

export type TeamMember = { id: string; fullName: string; role: string };

const STATUS_VARIANT: Record<string, "secondary" | "success" | "warning" | "danger" | "muted"> = {
  requested: "warning",
  scheduled: "secondary",
  completed: "success",
  cancelled: "muted",
  declined: "muted",
  missed: "danger",
};

/** Split a stored instant back into the two halves a form edits. */
function toDateAndTime(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: sgToday(), time: "14:00" };
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${hour}:${get("minute")}`,
  };
}

function CancelDialog({
  target,
  onDone,
}: {
  target: AdminCoachingRow | null;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const declining = target?.status === "requested";

  function confirm() {
    if (!target) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("sessionId", target.id);
      fd.set("reason", reason);

      const result = await cancelCoaching(fd);
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
    <Dialog open={target !== null} onOpenChange={(open) => !open && onDone()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {declining ? "Decline this request" : "Cancel this session"}
          </DialogTitle>
          <DialogDescription>
            {target && (
              <>
                <strong>{target.consultant_name}</strong> will be notified and
                shown the reason you give.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="coach-cancel-reason">Reason (required)</Label>
          <Textarea
            id="coach-cancel-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={pending}
            aria-invalid={error ? true : undefined}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" disabled={pending} onClick={onDone}>
            Keep it
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={confirm}
            data-testid="confirm-cancel-coaching"
          >
            {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
            {declining ? "Decline" : "Cancel session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NotesDialog({
  target,
  onDone,
}: {
  target: AdminCoachingRow | null;
  onDone: () => void;
}) {
  const [internal, setInternal] = useState(target?.internal_notes ?? "");
  const [outcome, setOutcome] = useState(target?.outcome_notes ?? "");
  const [pending, startTransition] = useTransition();

  function save() {
    if (!target) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("sessionId", target.id);
      fd.set("internalNotes", internal);
      fd.set("outcomeNotes", outcome);

      const result = await saveCoachingNotes(fd);
      if (result.ok) {
        onDone();
        if (result.message) toast.success(result.message);
      } else if (result.message) {
        toast.error(result.message);
      }
    });
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onDone()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Notes</DialogTitle>
          <DialogDescription>
            Only admins can read these. {target?.consultant_name} never sees
            them, including by looking at the data directly.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="coach-internal">Before the session</Label>
            <Textarea
              id="coach-internal"
              rows={4}
              value={internal}
              onChange={(e) => setInternal(e.target.value)}
              placeholder="What to raise"
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="coach-outcome">Afterwards</Label>
            <Textarea
              id="coach-outcome"
              rows={4}
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              placeholder="What was agreed"
              disabled={pending}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" disabled={pending} onClick={onDone}>
            Close
          </Button>
          <Button type="button" disabled={pending} onClick={save}>
            {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
            Save notes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScheduleDialog({
  target,
  team,
  onDone,
}: {
  target: AdminCoachingRow | null;
  team: TeamMember[];
  onDone: () => void;
}) {
  const initial = toDateAndTime(target?.scheduled_at ?? null);
  const [title, setTitle] = useState(
    target?.status === "requested" ? "" : (target?.title ?? ""),
  );
  const [category, setCategory] = useState<CoachingCategory>(
    (target?.category as CoachingCategory) ?? "monthly_review",
  );
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [coachId, setCoachId] = useState(target?.coach_id ?? "");
  const [location, setLocation] = useState(target?.location ?? "");
  const [agenda, setAgenda] = useState(target?.agenda ?? "");
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [pending, startTransition] = useTransition();

  const admins = team.filter((m) => m.role === "admin");

  function save() {
    if (!target) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("sessionId", target.id);
      fd.set("consultantId", target.consultant_id);
      fd.set("coachId", coachId);
      fd.set("title", title);
      fd.set("category", category);
      fd.set("date", date);
      fd.set("time", time);
      fd.set("location", location);
      fd.set("agenda", agenda);

      const result = await scheduleCoaching(fd);
      if (result.ok) {
        setErrors({});
        onDone();
        if (result.message) toast.success(result.message);
      } else {
        setErrors(result.fieldErrors ?? {});
        if (result.message) toast.error(result.message);
      }
    });
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onDone()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {target?.status === "requested" ? "Schedule this request" : "Edit session"}
          </DialogTitle>
          <DialogDescription>
            For {target?.consultant_name}. Moving the time clears their
            acknowledgement and sends a fresh notification.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {target?.requested_topic && (
            <div className="rounded-md bg-muted px-3 py-2">
              <p className="text-xs font-medium">They asked for</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {target.requested_topic}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="coach-title">Title</Label>
            <Input
              id="coach-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Monthly review"
              disabled={pending}
              aria-invalid={errors.title ? true : undefined}
            />
            {errors.title && (
              <p className="text-sm text-destructive">{errors.title}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="coach-date">Date</Label>
              <Input
                id="coach-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={pending}
                aria-invalid={errors.date ? true : undefined}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="coach-time">Time</Label>
              <Input
                id="coach-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                disabled={pending}
              />
            </div>
          </div>
          {errors.date && (
            <p className="text-sm text-destructive">{errors.date}</p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="coach-category">Category</Label>
              <select
                id="coach-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as CoachingCategory)}
                disabled={pending}
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-base"
              >
                {COACHING_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {COACHING_CATEGORY_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="coach-coach">Coach</Label>
              <select
                id="coach-coach"
                value={coachId}
                onChange={(e) => setCoachId(e.target.value)}
                disabled={pending}
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-base"
              >
                <option value="">Me</option>
                {admins.map((admin) => (
                  <option key={admin.id} value={admin.id}>
                    {admin.fullName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="coach-location">Where to meet</Label>
            <Input
              id="coach-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Office meeting room"
              disabled={pending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="coach-agenda">Agenda (they can read this)</Label>
            <Textarea
              id="coach-agenda"
              rows={3}
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
              disabled={pending}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" disabled={pending} onClick={onDone}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={save}
            data-testid="save-coaching"
          >
            {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Slot = { consultantId: string; time: string };

function CreateDialog({
  open,
  team,
  onOpenChange,
}: {
  open: boolean;
  team: TeamMember[];
  onOpenChange: (open: boolean) => void;
}) {
  const [title, setTitle] = useState("Monthly review");
  const [category, setCategory] = useState<CoachingCategory>("monthly_review");
  const [date, setDate] = useState(sgToday());
  const [coachId, setCoachId] = useState("");
  const [location, setLocation] = useState("");
  const [slots, setSlots] = useState<Slot[]>([{ consultantId: "", time: "14:00" }]);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [pending, startTransition] = useTransition();

  const admins = team.filter((m) => m.role === "admin");

  function updateSlot(index: number, patch: Partial<Slot>) {
    setSlots((current) =>
      current.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)),
    );
  }

  function submit() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("title", title);
      fd.set("category", category);
      fd.set("date", date);
      fd.set("coachId", coachId);
      fd.set("location", location);
      fd.set(
        "slots",
        JSON.stringify(slots.filter((s) => s.consultantId !== "")),
      );

      const result = await createCoachingBulk(fd);
      if (result.ok) {
        setSlots([{ consultantId: "", time: "14:00" }]);
        setErrors({});
        onOpenChange(false);
        if (result.message) toast.success(result.message);
      } else {
        setErrors(result.fieldErrors ?? {});
        if (result.message) toast.error(result.message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Book coaching</DialogTitle>
          <DialogDescription>
            Add as many people as you like on one date, each at their own time.
            Every session is created separately and can be changed on its own.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="new-title">Title</Label>
            <Input
              id="new-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={pending}
              aria-invalid={errors.title ? true : undefined}
            />
            {errors.title && (
              <p className="text-sm text-destructive">{errors.title}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="new-date">Date</Label>
              <Input
                id="new-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-category">Category</Label>
              <select
                id="new-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as CoachingCategory)}
                disabled={pending}
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-base"
              >
                {COACHING_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {COACHING_CATEGORY_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="new-coach">Coach</Label>
              <select
                id="new-coach"
                value={coachId}
                onChange={(e) => setCoachId(e.target.value)}
                disabled={pending}
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-base"
              >
                <option value="">Me</option>
                {admins.map((admin) => (
                  <option key={admin.id} value={admin.id}>
                    {admin.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-location">Where</Label>
              <Input
                id="new-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Office"
                disabled={pending}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Who, and when</Label>
            {slots.map((slot, index) => (
              <div key={index} className="flex items-center gap-2">
                <select
                  value={slot.consultantId}
                  onChange={(e) =>
                    updateSlot(index, { consultantId: e.target.value })
                  }
                  disabled={pending}
                  aria-label={`Person ${index + 1}`}
                  className="h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-base"
                >
                  <option value="">Choose someone</option>
                  {team.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.fullName}
                    </option>
                  ))}
                </select>
                <Input
                  type="time"
                  value={slot.time}
                  onChange={(e) => updateSlot(index, { time: e.target.value })}
                  disabled={pending}
                  aria-label={`Time ${index + 1}`}
                  className="w-32"
                />
                {slots.length > 1 && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={pending}
                    aria-label={`Remove person ${index + 1}`}
                    onClick={() =>
                      setSlots((s) => s.filter((_, i) => i !== index))
                    }
                  >
                    <X aria-hidden="true" />
                  </Button>
                )}
              </div>
            ))}
            {errors.slots && (
              <p className="text-sm text-destructive">{errors.slots}</p>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              data-testid="add-slot"
              onClick={() =>
                setSlots((s) => [...s, { consultantId: "", time: "14:00" }])
              }
            >
              <Plus aria-hidden="true" />
              Add another person
            </Button>
          </div>
        </div>

        <DialogFooter>
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
            onClick={submit}
            data-testid="create-coaching"
          >
            {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
            Book
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  row,
  onEdit,
  onCancel,
  onNotes,
}: {
  row: AdminCoachingRow;
  onEdit: (row: AdminCoachingRow) => void;
  onCancel: (row: AdminCoachingRow) => void;
  onNotes: (row: AdminCoachingRow) => void;
}) {
  const [pending, startTransition] = useTransition();

  function outcome(kind: "completed" | "missed" | "reopen") {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("sessionId", row.id);
      fd.set("outcome", kind);
      const result = await setCoachingOutcome(fd);
      if (result.message) {
        if (result.ok) toast.success(result.message);
        else toast.error(result.message);
      }
    });
  }

  const closed = ["cancelled", "declined", "completed", "missed"].includes(
    row.status,
  );

  // Only a session that has a time can have happened. A pending request has
  // none, so Complete and Missed are meaningless there - and the database
  // refuses them outright, which used to surface as an unexplained failure.
  const canClose = row.status === "scheduled";

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{row.consultant_name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {row.title}
              {row.coach_name ? ` · with ${row.coach_name}` : ""}
            </p>
          </div>
          <Badge variant={STATUS_VARIANT[row.status] ?? "secondary"}>
            {COACHING_STATUS_LABELS[row.status as CoachingStatus] ?? row.status}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {row.scheduled_at
              ? formatSgDateTime(row.scheduled_at)
              : "No time set yet"}
          </span>
          <span>
            {COACHING_CATEGORY_LABELS[row.category as CoachingCategory] ??
              row.category}
          </span>
          {row.status === "scheduled" &&
            (row.acknowledged_at ? (
              <span className="flex items-center gap-1 text-status-present">
                <CircleCheck className="size-3" aria-hidden="true" />
                Acknowledged
              </span>
            ) : (
              <span className="flex items-center gap-1 text-status-late">
                <Clock className="size-3" aria-hidden="true" />
                Not acknowledged
              </span>
            ))}
        </div>

        {row.requested_topic && row.status === "requested" && (
          <p className="rounded-md bg-muted px-2.5 py-2 text-xs text-muted-foreground">
            <strong>Asked for:</strong> {row.requested_topic}
          </p>
        )}

        {row.cancellation_reason && (
          <p className="rounded-md bg-muted px-2.5 py-2 text-xs text-muted-foreground">
            <strong>Reason:</strong> {row.cancellation_reason}
          </p>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          {!closed && (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onEdit(row)}
              >
                {row.status === "requested" ? "Schedule" : "Edit"}
              </Button>
              {canClose && (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    data-testid="complete-coaching"
                    onClick={() => outcome("completed")}
                  >
                    <Check aria-hidden="true" />
                    Complete
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    data-testid="missed-coaching"
                    onClick={() => outcome("missed")}
                  >
                    <UserX aria-hidden="true" />
                    Missed
                  </Button>
                </>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={() => onCancel(row)}
              >
                <Ban aria-hidden="true" />
                {row.status === "requested" ? "Decline" : "Cancel"}
              </Button>
            </>
          )}

          {(row.status === "completed" || row.status === "missed") && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => outcome("reopen")}
            >
              {pending ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <RotateCcw aria-hidden="true" />
              )}
              Reopen
            </Button>
          )}

          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onNotes(row)}
          >
            <NotebookPen aria-hidden="true" />
            Notes
            {(row.internal_notes || row.outcome_notes) && " ·"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The admin coaching list.
 *
 * Both admins see every session, requests included, so nothing waits unseen
 * while one of them is away.
 */
export function CoachingManager({
  rows,
  team,
}: {
  rows: AdminCoachingRow[];
  team: TeamMember[];
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("open");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminCoachingRow | null>(null);
  const [cancelling, setCancelling] = useState<AdminCoachingRow | null>(null);
  const [noting, setNoting] = useState<AdminCoachingRow | null>(null);

  const requests = rows.filter((r) => r.status === "requested");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (status === "open" && !["requested", "scheduled"].includes(row.status))
        return false;
      if (status !== "open" && status !== "all" && row.status !== status)
        return false;
      if (!q) return true;
      return (
        row.consultant_name.toLowerCase().includes(q) ||
        row.title.toLowerCase().includes(q) ||
        (row.coach_name?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [rows, query, status]);

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
            placeholder="Search person, title or coach"
            className="pl-9"
            aria-label="Search coaching"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter by status"
          className="h-11 rounded-md border border-input bg-background px-3 text-base"
        >
          <option value="open">Open</option>
          <option value="all">All</option>
          <option value="requested">Requested</option>
          <option value="scheduled">Scheduled</option>
          <option value="completed">Completed</option>
          <option value="missed">Missed</option>
          <option value="cancelled">Cancelled</option>
          <option value="declined">Declined</option>
        </select>
        <Button
          type="button"
          onClick={() => setCreating(true)}
          data-testid="book-coaching"
        >
          <Plus aria-hidden="true" />
          Book
        </Button>
      </div>

      {requests.length > 0 && status !== "requested" && (
        <p className="rounded-md border border-status-late/40 bg-status-late/10 px-3 py-2 text-sm">
          {requests.length} coaching request
          {requests.length === 1 ? "" : "s"} waiting to be scheduled.
        </p>
      )}

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="pt-5 text-center text-sm text-muted-foreground">
            {rows.length === 0
              ? "No coaching booked yet."
              : "Nothing matches those filters."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((row) => (
            <Row
              key={row.id}
              row={row}
              onEdit={setEditing}
              onCancel={setCancelling}
              onNotes={setNoting}
            />
          ))}
        </div>
      )}

      <CreateDialog open={creating} team={team} onOpenChange={setCreating} />

      {editing && (
        <ScheduleDialog
          key={editing.id}
          target={editing}
          team={team}
          onDone={() => setEditing(null)}
        />
      )}

      <CancelDialog target={cancelling} onDone={() => setCancelling(null)} />

      {noting && (
        <NotesDialog
          key={noting.id}
          target={noting}
          onDone={() => setNoting(null)}
        />
      )}
    </div>
  );
}
