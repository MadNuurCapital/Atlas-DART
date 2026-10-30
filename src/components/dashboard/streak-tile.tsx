import { Flame, Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { Streaks } from "@/lib/dashboard-payload";

/**
 * How many days in a row.
 *
 * Deliberately not a leaderboard, and deliberately nowhere near anybody else's
 * figures. The comparison on offer is with your own best run, which is a
 * comparison everybody can win.
 *
 * The copy changes with the state rather than always reading the same, because
 * "3 days" means something different on the day you are about to lose it than
 * on the day you set a record.
 */

function headline(s: Streaks): { title: string; sub: string } {
  if (s.current === 0 && s.longest === 0) {
    return {
      title: "Start a streak",
      sub: "Submit today and you are on one.",
    };
  }

  if (s.current === 0) {
    return {
      title: "Streak broken",
      sub: `Your best run was ${s.longest} day${s.longest === 1 ? "" : "s"}. Submit today to start again.`,
    };
  }

  if (s.current === s.longest && s.current > 1) {
    return {
      title: `${s.current} days — your best yet`,
      sub: s.submitted_today
        ? "Every day it runs from here is a new record."
        : "Submit today to extend the record.",
    };
  }

  return {
    title: `${s.current} day${s.current === 1 ? "" : "s"} in a row`,
    sub: s.submitted_today
      ? `Your best is ${s.longest}.`
      : `Submit today to keep it going. Your best is ${s.longest}.`,
  };
}

export function StreakTile({
  streaks,
  className = "",
}: {
  streaks: Streaks;
  className?: string;
}) {
  const { title, sub } = headline(streaks);
  const alive = streaks.current > 0;

  return (
    <Card className={className}>
      <CardContent className="flex items-center gap-4 py-5">
        <span
          aria-hidden="true"
          className={
            alive
              ? "flex size-12 shrink-0 items-center justify-center rounded-2xl bg-status-present/12 text-status-present"
              : "flex size-12 shrink-0 items-center justify-center rounded-2xl bg-secondary text-muted-foreground"
          }
        >
          {streaks.submitted_today ? (
            <Check className="size-6" />
          ) : (
            <Flame className="size-6" />
          )}
        </span>

        <div className="min-w-0">
          <p className="text-base font-semibold text-foreground">{title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{sub}</p>
        </div>
      </CardContent>
    </Card>
  );
}
