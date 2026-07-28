import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/constants";
import type { TargetShortfall, PendingInception } from "@/types/database";

function Progress({
  ratio,
  label,
}: {
  ratio: number | null;
  label: string;
}) {
  if (ratio === null) {
    return (
      <p className="text-sm text-muted-foreground">No target set</p>
    );
  }

  const pct = Math.min(ratio, 1) * 100;
  const over = ratio >= 1;

  return (
    <div className="space-y-1">
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={`h-full rounded-full transition-all ${
            over ? "bg-status-present" : "bg-primary"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs tabular-nums text-muted-foreground">
        {(ratio * 100).toFixed(1)}% of target
      </p>
    </div>
  );
}

function Period({
  title,
  achieved,
  target,
  shortfall,
  achievement,
  cases,
}: {
  title: string;
  achieved: number;
  target: number | null;
  shortfall: number | null;
  achievement: number | null;
  cases: number;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="text-xs text-muted-foreground">
          {cases} case{cases === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums">
          {formatCurrency(achieved)}
        </span>
        {target !== null && (
          <span className="text-sm text-muted-foreground tabular-nums">
            of {formatCurrency(target)}
          </span>
        )}
      </div>

      <Progress ratio={achievement} label={`${title} achievement`} />

      {target !== null && (
        <p className="text-sm">
          {shortfall !== null && shortfall > 0 ? (
            <>
              <span className="text-muted-foreground">Shortfall </span>
              <span className="font-medium tabular-nums text-status-late">
                {formatCurrency(shortfall)}
              </span>
            </>
          ) : (
            <Badge variant="success">Target met</Badge>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * Month-to-date and year-to-date GR against target.
 *
 * A missing target renders as "No target set" rather than as a zero target,
 * and achievement is null rather than a division by zero.
 */
export function TargetPanel({
  target,
  pending,
}: {
  target: TargetShortfall | null;
  pending: PendingInception | null;
}) {
  if (!target) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">GR against target</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Period
            title="This month"
            achieved={Number(target.month_to_date_gr)}
            target={target.monthly_target === null ? null : Number(target.monthly_target)}
            shortfall={
              target.monthly_shortfall === null
                ? null
                : Number(target.monthly_shortfall)
            }
            achievement={
              target.monthly_achievement === null
                ? null
                : Number(target.monthly_achievement)
            }
            cases={Number(target.month_active_cases)}
          />

          <Period
            title="This year"
            achieved={Number(target.year_to_date_gr)}
            target={target.yearly_target === null ? null : Number(target.yearly_target)}
            shortfall={
              target.yearly_shortfall === null
                ? null
                : Number(target.yearly_shortfall)
            }
            achievement={
              target.yearly_achievement === null
                ? null
                : Number(target.yearly_achievement)
            }
            cases={Number(target.year_active_cases)}
          />
        </div>

        {pending && Number(pending.pending_cases) > 0 && (
          <div className="rounded-md border border-status-late/30 bg-status-late/5 px-3 py-2.5 text-sm">
            <p className="font-medium">
              {pending.pending_cases} case
              {Number(pending.pending_cases) === 1 ? "" : "s"} pending inception
              · {formatCurrency(Number(pending.pending_gr))}
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
