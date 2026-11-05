import { Plane } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { addDays, formatSgDate } from "@/lib/sg-date";
import type { AwayRoster as AwayRosterRow } from "@/types/database";

/**
 * Who is away, for the team overview.
 *
 * Name, since when, and back when. Deliberately not the reason: a manager
 * needs to know who is out and when they return in order to plan, and
 * self-declared medical leave is not something to put on a dashboard that
 * anybody can walk past in order to answer that. The reason is on the daily
 * board, where it is read one row at a time.
 *
 * Renders nothing when nobody is away. An empty card headed "Away" is a
 * permanent reminder of a thing that is usually not happening, and the brief
 * for this was to keep it minimal.
 *
 * There is also deliberately no notification when somebody books leave. The
 * team does not need announcing to; an admin looking at this screen will see
 * it, which is what the screen is for.
 */
export function AwayRoster({
  rows,
  className = "",
}: {
  rows: AwayRosterRow[];
  className?: string;
}) {
  if (rows.length === 0) return null;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Plane className="size-4 text-status-away" aria-hidden="true" />
          Away today
          <span className="text-sm font-normal text-muted-foreground">
            ({rows.length})
          </span>
        </CardTitle>
      </CardHeader>

      <CardContent>
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li
              key={row.user_id}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2"
            >
              <span className="text-sm font-medium text-foreground">
                {row.full_name}
              </span>
              <span className="text-sm text-muted-foreground">
                {/* "Back on" rather than "until", because the day after the
                    last away day is the fact a manager is actually planning
                    around. Both dates are inclusive. */}
                Since {formatSgDate(row.starts_on)} · back{" "}
                {formatSgDate(addDays(row.ends_on, 1))}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
