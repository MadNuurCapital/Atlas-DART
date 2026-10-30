import { Briefcase, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { MonthCases } from "@/lib/dashboard-payload";

/**
 * Cases written this month, against your own best start.
 *
 * This replaced a streak counting submitted days. A streak measured whether
 * somebody had filled in a form; this measures business they wrote. For an
 * advisor the second is the one worth feeling something about, and it belongs
 * further up the page than the first ever did.
 *
 * The comparison is always with the SAME POINT in an earlier month - "5 by the
 * 12th" against "1 by the 12th" - never with a finished total. On the 3rd of
 * the month, comparing against a completed 9 would say you were behind when
 * you are three days in and doing fine.
 *
 * Nobody else appears here. The only comparison on offer is with your own
 * record, which is a comparison everybody can win.
 */

function lines(c: MonthCases): { title: string; sub: string } {
  const n = c.this_month;
  const plural = n === 1 ? "case" : "cases";

  if (n === 0) {
    // The 1st to the 5th of every month lands here, so it must not read as a
    // rebuke. Last month's total gives the zero some context.
    return {
      title: "No cases yet this month",
      sub:
        c.last_month > 0
          ? `${c.last_month} last month. The month is young.`
          : "Your first one will show up here.",
    };
  }

  if (c.is_best_start) {
    const ahead = n - c.best_start;
    return {
      title: `${n} ${plural} this month`,
      sub:
        c.best_start > 0
          ? `Your best start to a month yet — ${ahead} ahead of your previous best.`
          : "Your best start to a month yet.",
    };
  }

  const toBeat = c.best_start - n + 1;
  return {
    title: `${n} ${plural} this month`,
    sub: `${toBeat} more beats your best start of ${c.best_start}.`,
  };
}

export function MonthCasesTile({
  cases,
  className = "",
}: {
  cases: MonthCases;
  className?: string;
}) {
  const { title, sub } = lines(cases);

  return (
    <Card className={className}>
      <CardContent className="flex items-center gap-4 py-5">
        <span
          aria-hidden="true"
          className={
            cases.is_best_start
              ? "flex size-12 shrink-0 items-center justify-center rounded-2xl bg-status-present/12 text-status-present"
              : "flex size-12 shrink-0 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground"
          }
        >
          {cases.is_best_start ? (
            <TrendingUp className="size-6" />
          ) : (
            <Briefcase className="size-6" />
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
