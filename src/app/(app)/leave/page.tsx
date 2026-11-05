import type { Metadata } from "next";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LeaveManager } from "@/components/leave/leave-manager";
import { AwayBanner } from "@/components/leave/away-banner";
import { Card, CardContent } from "@/components/ui/card";
import { sgToday } from "@/lib/sg-date";
import type { LeavePeriod } from "@/types/database";

export const metadata: Metadata = { title: "Leave & Away Mode" };

/**
 * Leave & Away Mode.
 *
 * ONE query, and no RPC of its own. Row Level Security on leave_periods
 * already restricts this to the signed-in person's rows, so a plain select is
 * both the whole of the authorisation and the whole of the round trip - the
 * grouping into now / coming up / previously is presentation and belongs in
 * the component, not in Postgres.
 *
 * Cancelled periods are excluded. They are kept for the audit trail, which is
 * an admin's concern; showing an advisor a list of things they decided not to
 * do is clutter.
 *
 * The limit is a guard rather than a feature. Fifty periods is years of
 * holidays, and an unbounded select on a page is how a fast page stops being
 * one in three years' time.
 */
export default async function LeavePage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("leave_periods")
    .select("*")
    .eq("user_id", profile.id)
    .is("cancelled_at", null)
    .order("starts_on", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[leave] could not load periods: %s", error.message);
  }

  const periods = (data ?? []) as LeavePeriod[];
  const today = sgToday();
  const active =
    periods.find((p) => p.starts_on <= today && today <= p.ends_on) ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Leave &amp; Away Mode
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tell Atlas DART when you are away and it will stop asking for a DART
          on those days. No approval needed.
        </p>
      </div>

      {active && <AwayBanner leave={active} />}

      <LeaveManager periods={periods} />

      <Card>
        <CardContent className="space-y-2 pt-6 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">What Away Mode does</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>No evening reminders, and no 11:59 PM final call.</li>
            <li>
              Your attendance shows <span className="text-status-away">Away</span>{" "}
              instead of absent, and those days stop counting against your
              submission record.
            </li>
            <li>
              You can still submit a DART or log a case if you want to — nothing
              is blocked, and anything you do still counts.
            </li>
            <li>
              Everything resumes by itself the day after your leave ends. There
              is nothing to switch back on.
            </li>
          </ul>
          {/* Said plainly, because the alternative is somebody assuming
              otherwise and being surprised by an email. */}
          <p className="pt-1">
            Your admin can see that you are away and when you are back. The
            reason stays between you and them.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
