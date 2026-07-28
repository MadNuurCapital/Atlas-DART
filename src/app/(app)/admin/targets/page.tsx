import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  TargetEditor,
  type ConsultantTargets,
} from "@/components/admin/target-editor";
import { Button } from "@/components/ui/button";
import { parseBusinessDate, sgToday } from "@/lib/sg-date";
import type { ConsultantTarget, Profile } from "@/types/database";

export const metadata: Metadata = { title: "Targets" };
export const dynamic = "force-dynamic";

export default async function AdminTargetsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  await requireAdmin();
  const { year: yearParam } = await searchParams;

  const currentYear = parseBusinessDate(sgToday()).year;
  const year =
    yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : currentYear;

  const supabase = await createClient();

  const [{ data: profiles }, { data: targets }] = await Promise.all([
    supabase
      .from("profiles")
      .select("*")
      .eq("active", true)
      .order("full_name", { ascending: true }),
    supabase.from("consultant_targets").select("*").eq("year", year),
  ]);

  const targetRows = (targets as ConsultantTarget[]) ?? [];

  const consultants: ConsultantTargets[] = ((profiles as Profile[]) ?? []).map(
    (p) => {
      const yearly = targetRows.find(
        (t) => t.consultant_id === p.id && t.period_type === "yearly",
      );
      return {
        consultantId: p.id,
        fullName: p.full_name,
        role: p.role,
        yearlyTarget: yearly ? Number(yearly.gr_target) : null,
        monthlyOverrides: targetRows
          .filter(
            (t) => t.consultant_id === p.id && t.period_type === "monthly",
          )
          .map((t) => ({
            id: t.id,
            month: t.month ?? 0,
            grTarget: Number(t.gr_target),
          })),
      };
    },
  );

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">GR targets · {year}</h1>
          <p className="text-sm text-muted-foreground">
            The yearly figure is the one to maintain. Each month defaults to a
            twelfth of it unless you set an override. Changing {year} never
            touches another year.
          </p>
        </div>

        <div className="flex gap-1">
          <Button asChild size="sm" variant="ghost">
            <Link href={`/admin/targets?year=${year - 1}`}>{year - 1}</Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href={`/admin/targets?year=${year + 1}`}>{year + 1}</Link>
          </Button>
        </div>
      </div>

      <p className="rounded-md border border-border bg-muted px-3 py-2.5 text-xs text-muted-foreground">
        Every target change is written to the audit log with the old and new
        value, including changes you make to your own.
      </p>

      <TargetEditor year={year} consultants={consultants} />
    </div>
  );
}
