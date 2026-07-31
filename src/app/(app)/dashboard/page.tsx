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
import { TargetPanel } from "@/components/dashboard/target-panel";
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
    <div className="rounded-lg bg-secondary px-2 py-2.5 text-center">
      <div className="text-lg font-semibold tabular-nums text-secondary-foreground">
        {value}
      </div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
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

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Assalamualaikum, {firstName}</h1>
        <p className="text-sm text-muted-foreground">
          {formatSgDate(today)} · submissions close at {DEADLINE_LABEL}
        </p>
      </div>

      <Card
        className={
          isSubmitted ? undefined : "border-status-late/40 bg-status-late/5"
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

        <CardContent className="space-y-4">
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

          <Button asChild size="lg" className="w-full sm:w-auto">
            <Link href="/today">
              {isSubmitted ? "Review or update today" : "Fill in today"}
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </CardContent>
      </Card>

      <CoachingCard sessions={coaching} />

      <TargetPanel
        target={(targetRow as TargetShortfall | null) ?? null}
        pending={(pendingRow as PendingInception | null) ?? null}
      />

      <CaseMixPanel rows={(mixRows as CaseMixByCategory[]) ?? []} />

      <Card>
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

      {(() => {
        const yesterday = addDays(today, -1);
        const yesterdayRow = month_.find((r) => r.business_date === yesterday);
        if (yesterdayRow?.status === "submitted") return null;
        return (
          <Card className="border-dashed">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5">
              <p className="text-sm text-muted-foreground">
                Yesterday ({formatSgDate(yesterday)}) is not submitted.
              </p>
              <Button asChild size="sm" variant="secondary">
                <Link href={`/today?date=${yesterday}`}>Fill it in</Link>
              </Button>
            </CardContent>
          </Card>
        );
      })()}
    </div>
  );
}
