import { CalendarOff } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { MissedDays } from "@/lib/dashboard-payload";

/**
 * "You have not submitted for 3 days."
 *
 * What is left of the submission streak, and the useful half of it. A streak
 * congratulated somebody for an administrative habit; this says the one thing
 * about that habit actually worth saying - that they have stopped.
 *
 * RENDERS NOTHING WHEN THERE IS NOTHING TO SAY. A person who is up to date
 * sees no tile at all, rather than a green "0 days missed" taking up room on
 * the page to tell them everything is normal. The dashboard should get quieter
 * when you are doing well, not busier.
 *
 * Today is never counted. At ten in the morning nobody has submitted yet, and
 * a notice saying otherwise would appear every single morning and be ignored
 * by the second week.
 */
export function MissedDaysNotice({
  missed,
  className = "",
}: {
  missed: MissedDays;
  className?: string;
}) {
  // Up to date, or brand new. Neither needs telling.
  if (missed.missed === 0) return null;

  const days = missed.missed;

  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border border-status-late/40 bg-status-late/5 px-4 py-3 ${className}`}
    >
      <CalendarOff
        className="size-5 shrink-0 text-status-late"
        aria-hidden="true"
      />
      <p className="min-w-0 flex-1 text-sm text-foreground">
        <span className="font-semibold">
          {days} day{days === 1 ? "" : "s"} without a submission
        </span>
        {/* The count is the point; the window is the actionable part, because
            anything older than seven days needs an admin and saying so here
            saves somebody discovering it the hard way. */}
        <span className="text-muted-foreground">
          {days > 7
            ? " — the last seven are still editable, older days need an admin."
            : " — you can still fill them in."}
        </span>
      </p>
      <Button asChild size="sm" variant="outline" className="shrink-0">
        <Link href="/today">Catch up</Link>
      </Button>
    </div>
  );
}
