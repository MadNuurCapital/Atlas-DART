"use client";

import { useState, useTransition } from "react";
import {
  CalendarClock,
  Check,
  CircleCheck,
  Loader2,
  MapPin,
  MessageSquarePlus,
  User,
  Ban,
} from "lucide-react";
import { toast } from "sonner";
import {
  acknowledgeCoaching,
  requestCoaching,
} from "@/app/(app)/coaching/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
  COACHING_CATEGORIES,
  COACHING_CATEGORY_LABELS,
  type CoachingCategory,
} from "@/lib/constants";
import { describeWhen, formatSgDateTime } from "@/lib/sg-date";
import { cn } from "@/lib/utils";

export type MyCoaching = {
  id: string;
  title: string;
  category: string;
  message: string | null;
  location: string | null;
  requested_topic: string | null;
  agenda: string | null;
  scheduled_at: string | null;
  status: string;
  acknowledged_at: string | null;
  cancellation_reason: string | null;
  coach_name?: string | null;
};

/**
 * How loudly to shout, based on how close the session is.
 *
 * Weeks away it is a quiet line; inside a week it earns a full card; on the
 * day it is unmissable. Nothing is dismissible, for the same reason the DART
 * banner is not - a reminder you can wave away does nothing later.
 */
function urgency(scheduledAt: string | null, now: Date): "far" | "near" | "today" {
  if (!scheduledAt) return "far";
  const hours = (new Date(scheduledAt).getTime() - now.getTime()) / 3_600_000;
  if (hours <= 24) return "today";
  if (hours <= 24 * 7) return "near";
  return "far";
}

function RequestDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [topic, setTopic] = useState("");
  const [category, setCategory] = useState<CoachingCategory>("ad_hoc");
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("topic", topic);
      fd.set("category", category);

      const result = await requestCoaching(fd);
      if (result.ok) {
        setTopic("");
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ask for coaching</DialogTitle>
          <DialogDescription>
            Say what you would like help with. Your admin will pick a time and
            you will get a notification.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="coaching-category">What kind</Label>
            <select
              id="coaching-category"
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
            <Label htmlFor="coaching-topic">What would you like coached?</Label>
            <Textarea
              id="coaching-topic"
              rows={4}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. I keep losing CIS cases at the closing stage"
              disabled={pending}
              aria-invalid={errors.topic ? true : undefined}
            />
            {errors.topic && (
              <p className="text-sm text-destructive">{errors.topic}</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Not now
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={submit}
            data-testid="send-coaching-request"
          >
            {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
            Send request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SessionCard({
  session,
  now,
  compact,
}: {
  session: MyCoaching;
  now: Date;
  compact: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const level = urgency(session.scheduled_at, now);
  const acknowledged = session.acknowledged_at !== null;

  function acknowledge() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("sessionId", session.id);
      const result = await acknowledgeCoaching(fd);
      if (result.message) {
        if (result.ok) toast.success(result.message);
        else toast.error(result.message);
      }
    });
  }

  if (compact) {
    return (
      <div
        className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
        data-testid="coaching-compact"
      >
        <span className="min-w-0 truncate">{session.title}</span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {session.scheduled_at ? describeWhen(session.scheduled_at, now) : ""}
        </span>
      </div>
    );
  }

  return (
    <Card
      data-testid="coaching-card"
      data-urgency={level}
      className={cn(
        level === "today" && "border-primary/60 bg-primary/5",
        level === "near" && "border-primary/30",
      )}
    >
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
              <CalendarClock className="size-3.5" aria-hidden="true" />
              Upcoming coaching
            </p>
            <h2 className="mt-1 truncate font-semibold">{session.title}</h2>
          </div>
          <Badge variant={level === "today" ? "warning" : "secondary"}>
            {COACHING_CATEGORY_LABELS[
              session.category as CoachingCategory
            ] ?? session.category}
          </Badge>
        </div>

        {session.scheduled_at && (
          <p className="text-sm font-medium tabular-nums">
            {describeWhen(session.scheduled_at, now)}
            <span className="ml-2 font-normal text-muted-foreground">
              {formatSgDateTime(session.scheduled_at)}
            </span>
          </p>
        )}

        {session.message && (
          <p className="text-sm text-muted-foreground">{session.message}</p>
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {session.coach_name && (
            <span className="flex items-center gap-1.5">
              <User className="size-3" aria-hidden="true" />
              {session.coach_name}
            </span>
          )}
          {session.location && (
            <span className="flex items-center gap-1.5">
              <MapPin className="size-3" aria-hidden="true" />
              {session.location}
            </span>
          )}
        </div>

        {session.agenda && (
          <div className="rounded-md bg-muted px-3 py-2">
            <p className="text-xs font-medium">What we will cover</p>
            <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">
              {session.agenda}
            </p>
          </div>
        )}

        {acknowledged ? (
          <p className="flex items-center gap-1.5 text-xs text-status-present">
            <CircleCheck className="size-3.5" aria-hidden="true" />
            You have confirmed this
          </p>
        ) : (
          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={pending}
            onClick={acknowledge}
            data-testid="acknowledge-coaching"
          >
            {pending ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Check aria-hidden="true" />
            )}
            Got it
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * A consultant's coaching, on their dashboard.
 *
 * They see their own upcoming sessions and their own pending request, and
 * nothing else - no history, and never anybody else's. That is enforced by the
 * database policy, not by this component; what arrives here is already only
 * what they are allowed.
 */
export function CoachingCard({
  sessions,
  now = new Date(),
}: {
  sessions: MyCoaching[];
  now?: Date;
}) {
  const [requesting, setRequesting] = useState(false);

  const pendingRequest = sessions.find((s) => s.status === "requested");

  // Cancelled sessions are not shown at all - the person has already had a
  // notification, and a card they can do nothing about is just clutter. A
  // DECLINED request is different: they asked for something and are owed an
  // answer, and an answer that arrives as silence reads as being ignored.
  const declined = sessions.filter((s) => s.status === "declined");
  const upcoming = sessions
    .filter((s) => s.status === "scheduled" && s.scheduled_at)
    .sort(
      (a, b) =>
        new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime(),
    );

  const [next, ...rest] = upcoming;

  return (
    <div className="space-y-3" data-testid="coaching-section">
      {next && <SessionCard session={next} now={now} compact={false} />}

      {rest.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            Also coming up
          </p>
          {rest.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              now={now}
              compact
            />
          ))}
        </div>
      )}

      {declined.map((session) => (
        <Card key={session.id} className="border-dashed">
          <CardContent className="pt-5">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Ban className="size-4 text-muted-foreground" aria-hidden="true" />
              Coaching request declined
            </p>
            {session.cancellation_reason && (
              <p className="mt-1 text-sm text-muted-foreground">
                {session.cancellation_reason}
              </p>
            )}
          </CardContent>
        </Card>
      ))}

      {pendingRequest && (
        <Card className="border-dashed">
          <CardContent className="pt-5">
            <p className="text-sm font-medium">Coaching requested</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {pendingRequest.requested_topic}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Waiting for your admin to pick a time.
            </p>
          </CardContent>
        </Card>
      )}

      {!next && !pendingRequest && (
        <Card className="border-dashed">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5">
            <div>
              <p className="text-sm font-medium">No coaching booked</p>
              <p className="text-xs text-muted-foreground">
                Ask if there is something you would like help with.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setRequesting(true)}
              data-testid="request-coaching"
            >
              <MessageSquarePlus aria-hidden="true" />
              Ask for coaching
            </Button>
          </CardContent>
        </Card>
      )}

      <RequestDialog open={requesting} onOpenChange={setRequesting} />
    </div>
  );
}
