import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ExportForm } from "@/components/admin/export-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { parseBusinessDate, sgToday } from "@/lib/sg-date";

export const metadata: Metadata = { title: "Export" };
export const dynamic = "force-dynamic";

const SHEETS = [
  ["Daily Team Summary", "Every submission day by day, with D, TT, AO, AC, FU, N, cases, GR, office and submission timing."],
  ["Appointment Details", "Every prospect appointment behind those AO/AC/FU/N totals."],
  ["Case Tracker", "Every case submitted in the month, active and cancelled, with reason and cancelled date."],
  ["Targets and Shortfall", "Monthly and yearly target, achieved GR, shortfall and achievement."],
  ["Submission Compliance", "Required, submitted, on-time, late and missing days per person."],
  ["Case Mix by Category", "Counts and APE per policy type — the cross-tab from the old workbook."],
] as const;

export default async function AdminExportPage() {
  await requireAdmin();

  const today = sgToday();
  const { year, month } = parseBusinessDate(today);

  const supabase = await createClient();
  const { data: consultants } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("active", true)
    .order("full_name", { ascending: true });

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Monthly meeting report</h1>
        <p className="text-sm text-muted-foreground">
          Generated on the server from the same views the dashboard reads, so
          the figures always reconcile.
        </p>
      </div>

      <Card>
        <CardContent className="pt-5">
          <ExportForm
            consultants={consultants ?? []}
            currentYear={year}
            currentMonth={month}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">What is in the workbook</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2.5">
            {SHEETS.map(([name, description], i) => (
              <li key={name} className="flex gap-3 text-sm">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground">
                  {i + 1}
                </span>
                <span>
                  <span className="font-medium">{name}</span>
                  <span className="block text-muted-foreground">
                    {description}
                  </span>
                </span>
              </li>
            ))}
          </ol>

          <p className="mt-4 rounded-md border border-border bg-muted px-3 py-2.5 text-xs text-muted-foreground">
            Currency and percentages are written as real numbers with a format
            applied, not as text, so you can sort and total them yourself. Dates
            and times are Singapore time. GR counts toward the month a case was
            submitted; cancelled cases appear in full on the Case Tracker sheet
            but never count toward any total.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
