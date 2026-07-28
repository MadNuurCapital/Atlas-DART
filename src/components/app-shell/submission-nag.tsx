import Link from "next/link";
import { CircleAlert, ArrowRight, Clock } from "lucide-react";
import { nagLevel, nagCopy, timeLeftLabel, nagBusinessDate } from "@/lib/nag";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The banner that will not leave you alone until the day is submitted.
 *
 * There is deliberately no dismiss button. A reminder you can wave away is a
 * reminder that does nothing later, and the entire point is to stop people
 * losing a day to forgetting. It disappears the instant they submit - which is
 * the only way to make it go away, and that is the design.
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
    firm: "border-status-late/40 bg-status-late/10",
    urgent: "border-status-late/60 bg-status-late/15",
    final: "border-status-absent/60 bg-status-absent/15",
    overdue: "border-status-absent/60 bg-status-absent/15",
  }[level as "firm" | "urgent" | "final" | "overdue"];

  const iconTone = {
    firm: "text-status-late",
    urgent: "text-status-late",
    final: "text-status-absent",
    overdue: "text-status-absent",
  }[level as "firm" | "urgent" | "final" | "overdue"];

  // Overnight the banner is about yesterday, so it must link to yesterday.
  const target = nagBusinessDate();

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="submission-nag"
      data-level={level}
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3",
        tone,
        // Subtle enough not to be obnoxious on a desktop left open, obvious
        // enough to catch an eye at 10pm. Stops entirely for anyone who has
        // asked their device to reduce motion - the colour and the wording
        // already carry the urgency without it.
        (level === "urgent" || level === "final") &&
          "animate-pulse motion-reduce:animate-none",
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
        <Link href={`/today?date=${target}`}>
          Submit
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
    </div>
  );
}
