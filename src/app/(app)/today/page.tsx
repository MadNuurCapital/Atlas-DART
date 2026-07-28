import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DailyForm } from "@/components/daily/daily-form";
import { AppointmentManager } from "@/components/daily/appointment-manager";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  addDays,
  daysBetween,
  formatSgDate,
  isWithinEditWindow,
  sgToday,
  EDIT_WINDOW_DAYS,
} from "@/lib/sg-date";
import { DEADLINE_LABEL } from "@/lib/constants";
import type { AppointmentActivity, DailySubmission } from "@/types/database";

export const metadata: Metadata = { title: "Today" };

// Always current: this page is entirely about "what is true right now".
export const dynamic = "force-dynamic";

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const profile = await requireProfile();
  const { date } = await searchParams;

  const today = sgToday();
  // A date from the query string is only ever used to look up a row. The edit
  // window is enforced by RLS regardless of what is asked for here.
  const businessDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today;

  const supabase = await createClient();

  const [{ data: submission }, { data: appointments }] = await Promise.all([
    supabase
      .from("daily_submissions")
      .select("*")
      .eq("user_id", profile.id)
      .eq("business_date", businessDate)
      .maybeSingle(),
    supabase
      .from("appointment_activities")
      .select("*")
      .eq("user_id", profile.id)
      .eq("business_date", businessDate)
      .order("created_at", { ascending: true }),
  ]);

  const editable = isWithinEditWindow(businessDate, today);
  const age = daysBetween(businessDate, today);

  const readOnlyReason = !editable
    ? age < 0
      ? "That date is in the future. You can only submit for today or an earlier day."
      : `This day is outside the ${EDIT_WINDOW_DAYS}-day window. Ask an admin if it needs changing.`
    : undefined;

  const previousDate = addDays(businessDate, -1);
  const nextDate = addDays(businessDate, 1);
  const canGoForward = businessDate < today;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="icon" asChild>
          <Link
            href={`/today?date=${previousDate}`}
            aria-label={`Go to ${formatSgDate(previousDate)}`}
          >
            <ChevronLeft aria-hidden="true" />
          </Link>
        </Button>

        <div className="min-w-0 text-center">
          <h1 className="truncate text-lg font-semibold">
            {businessDate === today ? "Today" : formatSgDate(businessDate)}
          </h1>
          <p className="text-xs text-muted-foreground">
            {businessDate === today
              ? `${formatSgDate(today)} · closes ${DEADLINE_LABEL}`
              : `${age} day${age === 1 ? "" : "s"} ago`}
          </p>
        </div>

        {canGoForward ? (
          <Button variant="ghost" size="icon" asChild>
            <Link
              href={`/today?date=${nextDate}`}
              aria-label={`Go to ${formatSgDate(nextDate)}`}
            >
              <ChevronRight aria-hidden="true" />
            </Link>
          </Button>
        ) : (
          <div className="size-11" aria-hidden="true" />
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your numbers</CardTitle>
        </CardHeader>
        <CardContent>
          <DailyForm
            businessDate={businessDate}
            submission={(submission as DailySubmission | null) ?? null}
            readOnly={!editable}
            readOnlyReason={readOnlyReason}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Appointments</CardTitle>
          <p className="text-sm text-muted-foreground">
            AO, AC, FU and N are counted from these entries. You never type the
            totals.
          </p>
        </CardHeader>
        <CardContent>
          <AppointmentManager
            businessDate={businessDate}
            appointments={(appointments as AppointmentActivity[]) ?? []}
            readOnly={!editable}
          />
        </CardContent>
      </Card>
    </div>
  );
}
