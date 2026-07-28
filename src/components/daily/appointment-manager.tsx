"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, Trash2, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import {
  addAppointment,
  updateAppointment,
  deleteAppointment,
} from "@/app/(app)/today/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  APPOINTMENT_TYPES,
  APPOINTMENT_TYPE_CODES,
  APPOINTMENT_TYPE_LABELS,
  type AppointmentType,
} from "@/lib/constants";
import type { AppointmentActivity } from "@/types/database";

function AddAppointmentForm({ businessDate }: { businessDate: string }) {
  const [prospectName, setProspectName] = useState("");
  const [type, setType] = useState<AppointmentType>("opening");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function add() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("businessDate", businessDate);
      fd.set("prospectName", prospectName);
      fd.set("appointmentType", type);
      fd.set("note", note);

      const result = await addAppointment(fd);

      if (result.ok) {
        setProspectName("");
        setNote("");
        setType("opening");
        setError(undefined);
        if (result.message) toast.success(result.message);
      } else {
        setError(result.fieldErrors?.prospectName);
        if (result.message) toast.error(result.message);
      }
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-dashed border-border p-3">
      <div className="space-y-2">
        <Label htmlFor="prospectName">Prospect name</Label>
        <Input
          id="prospectName"
          value={prospectName}
          onChange={(e) => setProspectName(e.target.value)}
          placeholder="Who did you meet?"
          autoComplete="off"
          disabled={pending}
          aria-invalid={error ? true : undefined}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="appointmentType">Type</Label>
        <Select
          value={type}
          onValueChange={(v) => setType(v as AppointmentType)}
          disabled={pending}
        >
          <SelectTrigger id="appointmentType">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {APPOINTMENT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {APPOINTMENT_TYPE_LABELS[t]} ({APPOINTMENT_TYPE_CODES[t]})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="note">Note (optional)</Label>
        <Input
          id="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Anything worth remembering"
          disabled={pending}
        />
      </div>

      <Button
        type="button"
        variant="secondary"
        className="w-full"
        disabled={pending}
        data-testid="add-appointment"
        onClick={add}
      >
        {pending ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Plus aria-hidden="true" />
        )}
        Add appointment
      </Button>
    </div>
  );
}

function AppointmentRow({
  appointment,
  readOnly,
}: {
  appointment: AppointmentActivity;
  readOnly: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [prospectName, setProspectName] = useState(appointment.prospect_name);
  const [type, setType] = useState<AppointmentType>(
    appointment.appointment_type,
  );
  const [note, setNote] = useState(appointment.note ?? "");
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", appointment.id);
      fd.set("businessDate", appointment.business_date);
      fd.set("prospectName", prospectName);
      fd.set("appointmentType", type);
      fd.set("note", note);

      const result = await updateAppointment(fd);
      if (result.ok) {
        setEditing(false);
        if (result.message) toast.success(result.message);
      } else if (result.message) {
        toast.error(result.message);
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", appointment.id);
      const result = await deleteAppointment(fd);
      if (result.message) {
        if (result.ok) toast.success(result.message);
        else toast.error(result.message);
      }
    });
  }

  if (editing) {
    return (
      <li className="space-y-3 rounded-lg border border-border bg-background p-3">
        <Input
          value={prospectName}
          onChange={(e) => setProspectName(e.target.value)}
          aria-label="Prospect name"
          disabled={pending}
        />

        <Select
          value={type}
          onValueChange={(v) => setType(v as AppointmentType)}
          disabled={pending}
        >
          <SelectTrigger aria-label="Appointment type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {APPOINTMENT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {APPOINTMENT_TYPE_LABELS[t]} ({APPOINTMENT_TYPE_CODES[t]})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          aria-label="Note"
          disabled={pending}
        />

        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={pending} onClick={save}>
            {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => setEditing(false)}
          >
            <X aria-hidden="true" />
            Cancel
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
      <Badge
        variant="secondary"
        className="shrink-0 font-mono"
        title={APPOINTMENT_TYPE_LABELS[appointment.appointment_type]}
      >
        {APPOINTMENT_TYPE_CODES[appointment.appointment_type]}
      </Badge>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {appointment.prospect_name}
        </p>
        {appointment.note && (
          <p className="truncate text-xs text-muted-foreground">
            {appointment.note}
          </p>
        )}
      </div>

      {!readOnly && (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={pending}
            aria-label={`Edit appointment with ${appointment.prospect_name}`}
            onClick={() => setEditing(true)}
          >
            <Pencil aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={pending}
            aria-label={`Remove appointment with ${appointment.prospect_name}`}
            onClick={remove}
          >
            {pending ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 className="text-destructive" aria-hidden="true" />
            )}
          </Button>
        </div>
      )}
    </li>
  );
}

/**
 * Appointment list plus the add form.
 *
 * The AO/AC/FU/N counts shown here are derived from this list, never typed.
 * That is the whole point: a total and its detail cannot disagree if only one
 * of them exists.
 */
export function AppointmentManager({
  businessDate,
  appointments,
  readOnly,
}: {
  businessDate: string;
  appointments: AppointmentActivity[];
  readOnly: boolean;
}) {
  const counts: Record<AppointmentType, number> = {
    opening: 0,
    closing: 0,
    follow_up: 0,
    nomination: 0,
  };
  for (const a of appointments) counts[a.appointment_type] += 1;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-2">
        {APPOINTMENT_TYPES.map((type) => (
          <div
            key={type}
            className="rounded-lg bg-secondary px-2 py-2.5 text-center"
            title={APPOINTMENT_TYPE_LABELS[type]}
          >
            <div
              className="text-lg font-semibold tabular-nums text-secondary-foreground"
              data-testid={`count-${APPOINTMENT_TYPE_CODES[type]}`}
            >
              {counts[type]}
            </div>
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {APPOINTMENT_TYPE_CODES[type]}
            </div>
          </div>
        ))}
      </div>

      {appointments.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          No appointments logged for this day yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {appointments.map((a) => (
            <AppointmentRow key={a.id} appointment={a} readOnly={readOnly} />
          ))}
        </ul>
      )}

      {!readOnly && <AddAppointmentForm businessDate={businessDate} />}
    </div>
  );
}
