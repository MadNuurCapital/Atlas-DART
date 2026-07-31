import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GrRing } from "@/components/dashboard/gr-ring";
import { formatCurrency } from "@/lib/constants";
import type { TargetShortfall, PendingInception } from "@/types/database";

type Period = {
  achieved: number;
  target: number | null;
  shortfall: number | null;
  achievement: number | null;
  cases: number;
};

function monthOf(t: TargetShortfall): Period {
  return {
    achieved: Number(t.month_to_date_gr),
    target: t.monthly_target === null ? null : Number(t.monthly_target),
    shortfall: t.monthly_shortfall === null ? null : Number(t.monthly_shortfall),
    achievement:
      t.monthly_achievement === null ? null : Number(t.monthly_achievement),
    cases: Number(t.month_active_cases),
  };
}

function yearOf(t: TargetShortfall): Period {
  return {
    achieved: Number(t.year_to_date_gr),
    target: t.yearly_target === null ? null : Number(t.yearly_target),
    shortfall: t.yearly_shortfall === null ? null : Number(t.yearly_shortfall),
    achievement:
      t.yearly_achievement === null ? null : Number(t.yearly_achievement),
    cases: Number(t.year_active_cases),
  };
}

function Outcome({ period }: { period: Period }) {
  if (period.target === null) return null;
  if (period.shortfall !== null && period.shortfall > 0) {
    return (
      <p className="text-sm">
        <span className="text-muted-foreground">Shortfall </span>
        <span className="font-medium tabular-nums text-status-late">
          {formatCurrency(period.shortfall)}
        </span>
      </p>
    );
  }
  return <Badge variant="success">Target met</Badge>;
}

/**
 * The month, with the ring.
 *
 * The hero of the money half of the dashboard: one figure, one ring, one
 * sentence about what is left. Everything finer-grained lives on /cases.
 */
export function MonthTargetTile({
  target,
  className,
}: {
  target: TargetShortfall;
  className?: string;
}) {
  const p = monthOf(target);

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">GR this month</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-3 text-center">
        <GrRing ratio={p.achievement} label="Month to date" />

        <div>
          <p className="text-xl font-semibold tabular-nums">
            {formatCurrency(p.achieved)}
          </p>
          {p.target !== null && (
            <p className="text-xs tabular-nums text-muted-foreground">
              of {formatCurrency(p.target)}
            </p>
          )}
        </div>

        <Outcome period={p} />

        <p className="text-xs text-muted-foreground">
          {p.cases} active case{p.cases === 1 ? "" : "s"}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * The year, and anything still waiting to incept.
 *
 * The pending-inception note lives here rather than on the month tile because
 * a policy submitted in March and still not live in May is a yearly problem.
 */
export function YearTargetTile({
  target,
  pending,
  className,
}: {
  target: TargetShortfall;
  pending: PendingInception | null;
  className?: string;
}) {
  const p = yearOf(target);
  const pendingCases = pending ? Number(pending.pending_cases) : 0;

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">GR this year</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums">
            {formatCurrency(p.achieved)}
          </span>
          {p.target !== null && (
            <span className="text-sm tabular-nums text-muted-foreground">
              of {formatCurrency(p.target)}
            </span>
          )}
        </div>

        {p.achievement === null ? (
          <p className="text-sm text-muted-foreground">No target set</p>
        ) : (
          <div className="space-y-1">
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-secondary"
              role="progressbar"
              aria-valuenow={Math.round(p.achievement * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Year to date achievement"
            >
              <div
                className={`h-full rounded-full transition-all ${
                  p.achievement >= 1 ? "bg-status-present" : "bg-primary"
                }`}
                style={{ width: `${Math.min(p.achievement, 1) * 100}%` }}
              />
            </div>
            <p className="text-xs tabular-nums text-muted-foreground">
              {(p.achievement * 100).toFixed(1)}% of target ·{" "}
              {p.cases} active case{p.cases === 1 ? "" : "s"}
            </p>
          </div>
        )}

        <Outcome period={p} />

        {pending && pendingCases > 0 && (
          <div className="rounded-lg border border-status-late/30 bg-status-late/5 px-3 py-2.5 text-sm">
            <p className="font-medium">
              {pendingCases} case{pendingCases === 1 ? "" : "s"} pending
              inception · {formatCurrency(Number(pending.pending_gr))}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Already counted above. Add the inception date once the policy goes
              live, or cancel it if it never does.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
