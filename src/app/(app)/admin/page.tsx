import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Download, Target, Users } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { unwrap } from "@/lib/query";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TeamBoard } from "@/components/admin/team-board";
import { formatSgDate, sgToday, parseBusinessDate } from "@/lib/sg-date";
import { formatCurrency, DEADLINE_LABEL } from "@/lib/constants";
import type {
  TeamDailyRow,
  TargetShortfall,
  MonthlyComplianceRow,
} from "@/types/database";

export const metadata: Metadata = { title: "Team overview" };
export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  await requireAdmin();

  const today = sgToday();
  const { year, month } = parseBusinessDate(today);
  const supabase = await createClient();

  const [teamRes, targetsRes, complianceRes] = await Promise.all([
    supabase.rpc("team_daily", { p_date: today }),
    supabase.from("v_target_shortfall").select("*"),
    supabase.rpc("monthly_compliance", { p_year: year, p_month: month }),
  ]);

  // A failed read must not become a team that has apparently written nothing.
  const teamRows = unwrap(teamRes, "the team's day");
  const targets = unwrap(targetsRes, "team targets");
  const compliance = unwrap(complianceRes, "monthly compliance");

  const rows = ((teamRows as TeamDailyRow[]) ?? []).map((r) => ({
    ...r,
    active_gr: r.active_gr === null ? null : Number(r.active_gr),
  }));

  const targetRows = (targets as TargetShortfall[]) ?? [];
  const complianceRows = (compliance as MonthlyComplianceRow[]) ?? [];

  const teamMtdGr = targetRows.reduce(
    (s, t) => s + Number(t.month_to_date_gr),
    0,
  );
  const teamYtdGr = targetRows.reduce(
    (s, t) => s + Number(t.year_to_date_gr),
    0,
  );
  const teamMonthlyTarget = targetRows.reduce(
    (s, t) => s + (t.monthly_target === null ? 0 : Number(t.monthly_target)),
    0,
  );
  const withoutTarget = targetRows.filter((t) => t.yearly_target === null);

  const worstCompliance = [...complianceRows]
    .sort((a, b) => Number(a.compliance) - Number(b.compliance))
    .slice(0, 5);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Team overview</h1>
        <p className="text-sm text-muted-foreground">
          {formatSgDate(today)} · submissions close at {DEADLINE_LABEL}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Month-to-date GR
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {formatCurrency(teamMtdGr)}
            </p>
            {teamMonthlyTarget > 0 && (
              <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                of {formatCurrency(teamMonthlyTarget)} ·{" "}
                {((teamMtdGr / teamMonthlyTarget) * 100).toFixed(0)}%
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Year-to-date GR
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {formatCurrency(teamYtdGr)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-2 pt-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Quick actions
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="secondary">
                <Link href="/admin/export">
                  <Download aria-hidden="true" />
                  Export
                </Link>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <Link href="/admin/targets">
                  <Target aria-hidden="true" />
                  Targets
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {withoutTarget.length > 0 && (
        <Card className="border-status-late/40 bg-status-late/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5">
            <p className="text-sm">
              <Users className="mr-1.5 inline size-4" aria-hidden="true" />
              {withoutTarget.length}{" "}
              {withoutTarget.length === 1 ? "person has" : "people have"} no{" "}
              {year} target set:{" "}
              <span className="text-muted-foreground">
                {withoutTarget.map((t) => t.full_name).join(", ")}
              </span>
            </p>
            <Button asChild size="sm" variant="secondary">
              <Link href="/admin/targets">Set targets</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <TeamBoard initialRows={rows} businessDate={today} />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">
              Lowest compliance this month
            </CardTitle>
            <Button asChild size="sm" variant="ghost">
              <Link href="/admin/export">
                Full report
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {worstCompliance.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing to show yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {worstCompliance.map((c) => (
                <li
                  key={c.consultant_id}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="min-w-0 truncate">{c.full_name}</span>
                  <span className="flex shrink-0 items-center gap-2 tabular-nums text-muted-foreground">
                    {c.submitted_days}/{c.required_days} days
                    {Number(c.late_days) > 0 && (
                      <Badge variant="warning">{c.late_days} late</Badge>
                    )}
                    <Badge
                      variant={
                        Number(c.compliance) >= 1
                          ? "success"
                          : Number(c.compliance) >= 0.8
                            ? "warning"
                            : "danger"
                      }
                    >
                      {(Number(c.compliance) * 100).toFixed(0)}%
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
