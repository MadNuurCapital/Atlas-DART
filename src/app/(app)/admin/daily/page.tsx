import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "@/lib/query";
import { TeamBoard } from "@/components/admin/team-board";
import { Button } from "@/components/ui/button";
import { addDays, formatSgDate, sgToday } from "@/lib/sg-date";
import type { TeamDailyRow } from "@/types/database";

export const metadata: Metadata = { title: "Daily board" };
export const dynamic = "force-dynamic";

export default async function AdminDailyPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requireAdmin();
  const { date } = await searchParams;

  const today = sgToday();
  const businessDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today;

  const supabase = await createClient();
  const res = await supabase.rpc("team_daily", { p_date: businessDate });

  // A failed read must not look like a team that submitted nothing.
  const data = unwrap(res, "the team's day");

  const rows = ((data as TeamDailyRow[]) ?? []).map((r) => ({
    ...r,
    active_gr: r.active_gr === null ? null : Number(r.active_gr),
  }));

  const canGoForward = businessDate < today;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">
            {businessDate === today ? "Today" : formatSgDate(businessDate)}
          </h1>
          <p className="text-sm text-muted-foreground">
            Everyone who should submit, whether they have or not.
          </p>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" asChild>
            <Link
              href={`/admin/daily?date=${addDays(businessDate, -1)}`}
              aria-label="Previous day"
            >
              <ChevronLeft aria-hidden="true" />
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/admin/daily">Today</Link>
          </Button>
          {canGoForward ? (
            <Button variant="ghost" size="icon" asChild>
              <Link
                href={`/admin/daily?date=${addDays(businessDate, 1)}`}
                aria-label="Next day"
              >
                <ChevronRight aria-hidden="true" />
              </Link>
            </Button>
          ) : (
            <div className="size-11" aria-hidden="true" />
          )}
        </div>
      </div>

      <TeamBoard initialRows={rows} businessDate={businessDate} />
    </div>
  );
}
