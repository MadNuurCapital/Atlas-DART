import Link from "next/link";
import { Plane } from "lucide-react";
import { LEAVE_REASON_LABELS, type LeaveReason } from "@/lib/constants";
import { addDays, formatSgDate, sgToday } from "@/lib/sg-date";

/**
 * The "Away Mode is active" indicator.
 *
 * Blue, and deliberately not shaped like the submission nag. The nag is a
 * demand with no dismiss button; this is a reassurance. Making them look alike
 * would undo the point of the feature - somebody on holiday opening the app
 * should be able to tell at a glance that it has stopped asking.
 *
 * Server component. It renders from the app shell's existing bootstrap call,
 * so it costs no round trip and no client JavaScript.
 */
export function AwayBanner({
  leave,
  withLink = false,
}: {
  leave: { starts_on: string; ends_on: string; reason: LeaveReason };
  /** Set on pages other than /leave, where the manager is a tap away. */
  withLink?: boolean;
}) {
  const today = sgToday();
  const back = addDays(leave.ends_on, 1);
  const lastDay = leave.ends_on === today;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-status-away/40 bg-status-away/8 px-4 py-3">
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-status-away/15 text-status-away"
      >
        <Plane className="size-4" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">
          Away Mode is on
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {LEAVE_REASON_LABELS[leave.reason]} ·{" "}
          {lastDay
            ? // Worth distinguishing: on the last day the useful fact is that
              // normal service resumes tomorrow, not that leave "ends today",
              // which reads as though it has already ended.
              `Last day. Reminders resume ${formatSgDate(back)}.`
            : `Until ${formatSgDate(leave.ends_on)}. Back ${formatSgDate(back)}.`}
        </p>
      </div>

      {withLink && (
        <Link
          href="/leave"
          className="shrink-0 text-sm font-medium text-status-away underline-offset-4 hover:underline"
        >
          Manage
        </Link>
      )}
    </div>
  );
}
