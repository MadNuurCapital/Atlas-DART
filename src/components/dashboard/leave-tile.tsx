import Link from "next/link";
import { Plane, CalendarPlus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { LEAVE_REASON_LABELS } from "@/lib/constants";
import { addDays, formatSgDate } from "@/lib/sg-date";
import type { DashboardLeave } from "@/lib/dashboard-payload";

/**
 * Leave & Away Mode, on the dashboard.
 *
 * A summary and a way in, not the manager - the manager is at /leave. This is
 * also the only entry point on a phone, because the bottom navigation already
 * carries five items and five is as many as fit.
 *
 * Three states, and the quiet one matters most. With no leave booked this is a
 * single line offering the feature; it does not grow a heading, an empty list
 * and a call to action for something most people are not doing this month. The
 * dashboard the team just had made faster does not get slower to advertise a
 * screen nobody needs today.
 */
export function LeaveTile({
  leave,
  className = "",
}: {
  leave: DashboardLeave | null;
  className?: string;
}) {
  if (!leave) {
    return (
      <Card className={className}>
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground"
          >
            <CalendarPlus className="size-4" />
          </span>
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">
            Going away? Schedule it and Atlas DART will stop chasing you for
            those days.
          </p>
          <Link
            href="/leave"
            className="shrink-0 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Schedule leave
          </Link>
        </CardContent>
      </Card>
    );
  }

  const back = addDays(leave.ends_on, 1);

  return (
    <Card
      className={`${
        leave.active
          ? "border-status-away/40 bg-status-away/5"
          : ""
      } ${className}`}
    >
      <CardContent className="flex flex-wrap items-center gap-3 py-4">
        <span
          aria-hidden="true"
          className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${
            leave.active
              ? "bg-status-away/15 text-status-away"
              : "bg-secondary text-muted-foreground"
          }`}
        >
          <Plane className="size-4" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {leave.active ? "Away Mode is on" : "Leave coming up"}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {LEAVE_REASON_LABELS[leave.reason]} ·{" "}
            {leave.active
              ? `Back ${formatSgDate(back)}`
              : `${formatSgDate(leave.starts_on)} – ${formatSgDate(leave.ends_on)}`}
          </p>
        </div>

        <Link
          href="/leave"
          className={`shrink-0 text-sm font-medium underline-offset-4 hover:underline ${
            leave.active ? "text-status-away" : "text-primary"
          }`}
        >
          Manage
        </Link>
      </CardContent>
    </Card>
  );
}
