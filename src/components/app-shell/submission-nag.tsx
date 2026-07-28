import Link from "next/link";
import { CircleAlert, ArrowRight, Clock } from "lucide-react";
import { nagLevel, nagCopy, timeLeftLabel } from "@/lib/nag";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The banner that will not leave you alone until today is submitted.
 *
 * There is deliberately no dismiss button. A reminder you can wave away at
 * 9am is a reminder that does nothing at 11pm, and the entire point is to stop
 * people forgetting. It disappears the instant they submit - which is the only
 * way to make it go away, and that is the design.
 */
export function SubmissionNag({
  submitted,
  firstName,
}: {
  submitted: boolean;
  firstName?: string;
}) {
  const level = nagLevel(submitted);
  const copy = nagCopy(level, firstName);

  if (!copy) return null;

  const tone = {
    gentle: "border-border bg-card",
    firm: "border-status-late/40 bg-status-late/10",
    urgent: "border-status-late/60 bg-status-late/15",
    final: "border-status-absent/60 bg-status-absent/15",
  }[level as "gentle" | "firm" | "urgent" | "final"];

  const iconTone = {
    gentle: "text-muted-foreground",
    firm: "text-status-late",
    urgent: "text-status-late",
    final: "text-status-absent",
  }[level as "gentle" | "firm" | "urgent" | "final"];

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="submission-nag"
      data-level={level}
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3",
        tone,
        // The last two levels pulse. Subtle enough not to be obnoxious on a
        // desktop left open all day, obvious enough to catch an eye at 10pm.
        (level === "urgent" || level === "final") && "animate-pulse",
      )}
    >
      <CircleAlert
        className={cn("size-5 shrink-0", iconTone)}
        aria-hidden="true"
      />

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{copy.title}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="size-3" aria-hidden="true" />
          {timeLeftLabel()} · {copy.body}
        </p>
      </div>

      <Button asChild size="sm" className="shrink-0">
        <Link href="/today">
          Submit
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
    </div>
  );
}
