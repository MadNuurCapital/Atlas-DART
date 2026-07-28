import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck, CircleAlert, Pencil } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "@/lib/query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  addDays,
  businessDatesInMonth,
  formatSgDate,
  formatSgTime,
  isWithinEditWindow,
  sgToday,
  parseBusinessDate,
} from "@/lib/sg-date";
import { formatCurrency } from "@/lib/constants";
import type { DailyConsultantSummary } from "@/types/database";

export const metadata: Metadata = { title: "History" };
export const dynamic = "force-dynamic";

const LOOKBACK_DAYS = 45;

export default async function HistoryPage() {
  const profile = await requireProfile();
  const today = sgToday();
  const from = addDays(today, -LOOKBACK_DAYS);

  const supabase = await createClient();
  const res = await supabase
    .from("v_daily_consultant_summary")
    .select("*")
    .eq("user_id", profile.id)
    .gte("business_date", from)
    .lte("business_date", today)
    .order("business_date", { ascending: false });

  // A failed read must not look like an empty history.
  const data = unwrap(res, "your submission history");

  const rows = (data as DailyConsultantSummary[]) ?? [];
  const byDate = new Map(rows.map((r) => [r.business_date, r]));

  // Every calendar day is required, so the list is built from the calendar and
  // missing days appear as rows rather than as gaps.
  const { year, month } = parseBusinessDate(today);
  const currentMonthDates = businessDatesInMonth(year, month, today);
  const allDates = Array.from(
    new Set([
      ...currentMonthDates,
      ...Array.from({ length: LOOKBACK_DAYS + 1 }, (_, i) =>
        addDays(today, -i),
      ),
    ]),
  )
    .filter((d) => d >= from && d <= today)
    .sort()
    .reverse();

  const submittedCount = rows.filter((r) => r.status === "submitted").length;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Submission history</h1>
        <p className="text-sm text-muted-foreground">
          Last {LOOKBACK_DAYS} days · {submittedCount} submitted. You can still
          correct anything from the past week.
        </p>
      </div>

      <ul className="space-y-2">
        {allDates.map((date) => {
          const row = byDate.get(date);
          const editable = isWithinEditWindow(date, today);
          const missing = !row || row.status !== "submitted";

          return (
            <li key={date}>
              <Card>
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">
                        {date === today ? "Today" : formatSgDate(date)}
                      </span>

                      {!row && <Badge variant="danger">Not started</Badge>}
                      {row?.status === "draft" && (
                        <Badge variant="muted">Draft</Badge>
                      )}
                      {row?.status === "submitted" && (
                        <Badge variant={row.on_time ? "success" : "warning"}>
                          {row.on_time ? (
                            <CircleCheck
                              className="size-3"
                              aria-hidden="true"
                            />
                          ) : (
                            <CircleAlert
                              className="size-3"
                              aria-hidden="true"
                            />
                          )}
                          {row.on_time ? "On time" : "Late"}
                        </Badge>
                      )}
                      {row && row.revision_count > 0 && (
                        <Badge variant="outline">
                          {row.revision_count} revision
                          {row.revision_count === 1 ? "" : "s"}
                        </Badge>
                      )}
                    </div>

                    {row ? (
                      <p className="mt-1 truncate text-xs tabular-nums text-muted-foreground">
                        D {row.dials} · TT {row.talked_to} · AO{" "}
                        {row.appointments_opening} · AC{" "}
                        {row.appointments_closing} · FU{" "}
                        {row.appointments_follow_up} · N{" "}
                        {row.appointments_nomination}
                        {row.signed_cases > 0 &&
                          ` · ${row.signed_cases} case${row.signed_cases === 1 ? "" : "s"} ${formatCurrency(row.active_gr)}`}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Nothing recorded for this day.
                      </p>
                    )}

                    {row?.first_submitted_at && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Submitted {formatSgTime(row.first_submitted_at)}
                        {row.last_submitted_at &&
                          row.last_submitted_at !== row.first_submitted_at &&
                          ` · updated ${formatSgTime(row.last_submitted_at)}`}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      aria-label={
                        row?.in_office ? "In the office" : "Not in the office"
                      }
                      title={
                        row?.in_office ? "In the office" : "Not in the office"
                      }
                      className={`size-3 rounded-full ${
                        !row
                          ? "bg-status-missing"
                          : row.in_office
                            ? "bg-status-present"
                            : "bg-status-absent"
                      }`}
                    />
                    {editable && (
                      <Button asChild size="sm" variant="ghost">
                        <Link
                          href={`/today?date=${date}`}
                          aria-label={`${missing ? "Fill in" : "Edit"} ${formatSgDate(date)}`}
                        >
                          <Pencil aria-hidden="true" />
                          {missing ? "Fill in" : "Edit"}
                        </Link>
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
