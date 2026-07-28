import type { Metadata } from "next";
import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "@/lib/query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  APPOINTMENT_TYPE_CODES,
  APPOINTMENT_TYPE_LABELS,
} from "@/lib/constants";
import { addDays, formatSgDate, sgToday } from "@/lib/sg-date";
import type { AppointmentActivity } from "@/types/database";

export const metadata: Metadata = { title: "Appointments" };
export const dynamic = "force-dynamic";

const LOOKBACK_DAYS = 30;

export default async function AppointmentsPage() {
  const profile = await requireProfile();
  const today = sgToday();
  const from = addDays(today, -LOOKBACK_DAYS);

  const supabase = await createClient();
  const res = await supabase
    .from("appointment_activities")
    .select("*")
    .eq("user_id", profile.id)
    .gte("business_date", from)
    .lte("business_date", today)
    .order("business_date", { ascending: false })
    .order("created_at", { ascending: true });

  // A failed read must not look like an empty history.
  const data = unwrap(res, "your appointments");

  const appointments = (data as AppointmentActivity[]) ?? [];

  const byDate = appointments.reduce<Record<string, AppointmentActivity[]>>(
    (acc, a) => {
      (acc[a.business_date] ??= []).push(a);
      return acc;
    },
    {},
  );
  const dates = Object.keys(byDate).sort().reverse();

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Appointments</h1>
        <p className="text-sm text-muted-foreground">
          The last {LOOKBACK_DAYS} days. Add or change appointments on the day
          itself.
        </p>
      </div>

      {dates.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 pt-5 text-sm text-muted-foreground">
            <p>No appointments logged in the last {LOOKBACK_DAYS} days.</p>
            <Button asChild size="sm" variant="secondary">
              <Link href="/today">Add today&rsquo;s appointments</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        dates.map((date) => {
          const rows = byDate[date] ?? [];
          return (
            <Card key={date}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm font-semibold">
                    {date === today ? "Today" : formatSgDate(date)}
                  </CardTitle>
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/today?date=${date}`}>Open</Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {rows.map((a) => (
                    <li key={a.id} className="flex items-center gap-3">
                      <Badge
                        variant="secondary"
                        className="shrink-0 font-mono"
                        title={APPOINTMENT_TYPE_LABELS[a.appointment_type]}
                      >
                        {APPOINTMENT_TYPE_CODES[a.appointment_type]}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{a.prospect_name}</p>
                        {a.note && (
                          <p className="truncate text-xs text-muted-foreground">
                            {a.note}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
