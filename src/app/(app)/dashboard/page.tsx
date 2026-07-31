import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck, CircleAlert, ArrowRight } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { unwrap } from "@/lib/query";
import { fetchMyCoaching } from "@/lib/coaching";
import { CoachingCard } from "@/components/coaching/coaching-card";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  formatSgDate,
  formatSgTime,
  sgToday,
  addDays,
  parseBusinessDate,
  requiredDaysInMonth,
} from "@/lib/sg-date";
import { DEADLINE_LABEL, CAMPAIGN_STATUS_LABELS } from "@/lib/constants";
import { compliancePercent } from "@/lib/targets";
import {
  MonthTargetTile,
  YearTargetTile,
} from "@/components/dashboard/target-panel";
import { CaseMixPanel } from "@/components/dashboard/case-mix-panel";
import type {
  CaseMixByCategory,
  DailyConsultantSummary,
  PendingInception,
  TargetShortfall,
} from "@/types/database";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-secondary/70 px-2 py-3 text-center">
      <div className="text-xl font-semibold tabular-nums text-secondary-foreground">
        {value}
      </div>
      <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  const profile = await requireProfile();
  const today = sgToday();
  const { year, month } = parseBusinessDate(today);
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;

  const supabase = await createClient();

  const [todayRes, monthRes, targetRes, pendingRes, mixRes, coaching] =
    await Promise.all([
      supabase
        .from("v_daily_consultant_summary")
        .select("*")
        .eq("user_id", profile.id)
        .eq("business_date", today)
        .maybeSingle(),
      supabase
        .from("v_daily_consultant_summary")
        .select("*")
        .eq("user_id", profile.id)
        .gte("business_date", monthStart)
        .lte("business_date", today),
      supabase
        .from("v_target_shortfall")
        .select("*")
        .eq("consultant_id", profile.id)
        .maybeSingle(),
      supabase
        .from("v_pending_inception")
        .select("*")
        .eq("consultant_id", profile.id)
        .maybeSingle(),
      supabase
        .from("v_case_mix_by_category")
        .select("*")
        .eq("consultant_id", profile.id)
        .eq("year", year)
        .eq("month", month),
      // Throws on a failed read rather than rendering as "no coaching booked",
      // which would look identical to genuinely having none.
      fetchMyCoaching(supabase),
    ]);

  // A failed read must not render as a zero. Showing S$0 to someone who has
  // written business this month is worse than an error screen, because they
  // have no way to tell it apart from the truth.
  const todayRow = unwrap(todayRes, "today's submission");
  const monthRows = unwrap(monthRes, "this month's submissions");
  const targetRow = unwrap(targetRes, "your target");
  const pendingRow = unwrap(pendingRes, "pending inceptions");
  const mixRows = unwrap(mixRes, "the category mix");

  const summary = (todayRow as DailyConsultantSummary | null) ?? null;
  const month_ = (monthRows as DailyConsultantSummary[]) ?? [];

  const submittedDays = month_.filter((r) => r.status === "submitted").length;
  const requiredDays = requiredDaysInMonth(year, month, today);
  const compliance = compliancePercent(submittedDays, requiredDays);
  const lateDays = month_.filter(
    (r) => r.status === "submitted" && !r.on_time,
  ).length;

  const isSubmitted = summary?.status === "submitted";
  const firstName = profile.full_name.split(" ")[0] ?? profile.full_name;

  const targetRow_ = (targetRow as TargetShortfall | null) ?? null;
  const yesterday = addDays(today, -1);
  const yesterdayMissing =
    month_.find((r) => r.business_date === yesterday)?.status !== "submitted";

  return (
    /* The bento grid.
     *
     * Six columns on a laptop so tiles can be 4+2 or 3+3 or 2+2+2 and still
     * line up; two on a tablet; one on a phone, where a grid of small tiles is
     * just a stack with extra steps. `auto-rows-min` keeps a short tile short
     * rather than stretching it to match its tallest neighbour. */
    <div className="mx-auto grid w-full max-w-6xl auto-rows-min grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
      <div className="sm:col-span-2 lg:col-span-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Assalamualaikum, {firstName}
        </h1>
        <p className="text-sm text-muted-foreground">
          {formatSgDate(today)} · submissions close at {DEADLINE_LABEL}
        </p>
      </div>

      <Card
        className={
          isSubmitted
            ? // The lit edge marks the one tile the eye should land on first.
              "edge-light lifted flex flex-col sm:col-span-2 lg:col-span-4"
            : "border-status-late/40 bg-status-late/5 flex flex-col sm:col-span-2 lg:col-span-4"
        }
      >
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">Today</CardTitle>
            {isSubmitted ? (
              <Badge variant={summary.on_time ? "success" : "warning"}>
                <CircleCheck className="size-3" aria-hidden="true" />
                {summary.on_time ? "Submitted on time" : "Submitted late"}
              </Badge>
            ) : (
              <Badge variant="warning">
                <CircleAlert className="size-3" aria-hidden="true" />
                {summary ? "Draft only" : "Not submitted"}
              </Badge>
            )}
          </div>
        </CardHeader>

        {/* flex-1 + mt-auto below: when the ring tile beside this one is
            taller, the leftover height opens up between the figures and the
            button rather than pooling as dead space under it. */}
        <CardContent className="flex flex-1 flex-col gap-4">
          {summary ? (
            <>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                <Stat label="D" value={summary.dials} />
                <Stat label="TT" value={summary.talked_to} />
                <Stat label="AO" value={summary.appointments_opening} />
                <Stat label="AC" value={summary.appointments_closing} />
                <Stat label="FU" value={summary.appointments_follow_up} />
                <Stat label="N" value={summary.appointments_nomination} />
              </div>

              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className={`size-3 rounded-full ${
                      summary.in_office
                        ? "bg-status-present"
                        : "bg-status-absent"
                    }`}
                  />
                  {summary.in_office ? "In the office" : "Not in the office"}
                </span>
                <span>
                  Campaign {CAMPAIGN_STATUS_LABELS[summary.campaign_status]}
                </span>
                {summary.first_submitted_at && (
                  <span>
                    Submitted {formatSgTime(summary.first_submitted_at)}
                  </span>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing recorded yet today. It takes about two minutes.
            </p>
          )}

          <div className="mt-auto space-y-3">
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link href="/today">
                {isSubmitted ? "Review or update today" : "Fill in today"}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>

            {/* Yesterday, inside today's tile rather than as a card of its
                own. A separate dashed box for a one-line nudge was a whole
                tile spent on something that is usually not true. */}
            {yesterdayMissing && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border px-3 py-2.5">
                <p className="text-sm text-muted-foreground">
                  Yesterday ({formatSgDate(yesterday)}) is not submitted.
                </p>
                <Button asChild size="sm" variant="secondary">
                  <Link href={`/today?date=${yesterday}`}>Fill it in</Link>
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {targetRow_ && (
        <MonthTargetTile target={targetRow_} className="lg:col-span-2" />
      )}

      <CoachingCard
        sessions={coaching}
        className="sm:col-span-2 lg:col-span-3"
      />

      <Card className="sm:col-span-2 lg:col-span-3">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">This month</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Stat
              label="Submitted"
              value={`${submittedDays}/${requiredDays}`}
            />
            <Stat label="Late" value={lateDays} />
            <Stat
              label="Compliance"
              value={`${(compliance * 100).toFixed(0)}%`}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Every calendar day counts, including weekends and public holidays.
            You can still correct the last seven days.
          </p>
          <Button asChild variant="ghost" size="sm">
            <Link href="/history">
              See full history
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </CardContent>
      </Card>

      <CaseMixPanel
        rows={(mixRows as CaseMixByCategory[]) ?? []}
        className="sm:col-span-2 lg:col-span-4"
      />

      {targetRow_ && (
        <YearTargetTile
          target={targetRow_}
          pending={(pendingRow as PendingInception | null) ?? null}
          className="lg:col-span-2"
        />
      )}
    </div>
  );
}
