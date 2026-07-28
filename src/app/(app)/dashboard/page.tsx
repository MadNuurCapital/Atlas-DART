import type { Metadata } from "next";
import { requireProfile } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatSgDate, sgToday } from "@/lib/sg-date";
import { DEADLINE_LABEL } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function DashboardPage() {
  const profile = await requireProfile();

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">
          Assalamualaikum, {profile.full_name.split(" ")[0]}
        </h1>
        <p className="text-sm text-muted-foreground">
          {formatSgDate(sgToday())} · submissions close at {DEADLINE_LABEL}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Foundation in place</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Sign-in, session handling, the database schema and the Row Level
            Security policies are built and tested.
          </p>
          <p>
            The daily submission form, appointments, cases, targets and the
            monthly export arrive in the phases that follow.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
