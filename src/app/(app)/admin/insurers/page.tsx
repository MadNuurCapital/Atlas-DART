import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { InsurerManager } from "@/components/admin/insurer-manager";
import type { Insurer } from "@/types/database";

export const metadata: Metadata = { title: "Insurers" };
export const dynamic = "force-dynamic";

export default async function AdminInsurersPage() {
  await requireAdmin();
  const supabase = await createClient();

  const [{ data: insurers }, { data: cases }] = await Promise.all([
    supabase.from("insurers").select("*").order("name", { ascending: true }),
    supabase.from("cases").select("insurer_id"),
  ]);

  const caseCounts = ((cases as { insurer_id: string }[]) ?? []).reduce<
    Record<string, number>
  >((acc, row) => {
    acc[row.insurer_id] = (acc[row.insurer_id] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Insurers</h1>
        <p className="text-sm text-muted-foreground">
          Consultants add insurers as they need them. Rename one and every
          existing case follows, because cases reference it by id rather than by
          name.
        </p>
      </div>

      <p className="rounded-md border border-border bg-muted px-3 py-2.5 text-xs text-muted-foreground">
        Retiring an insurer only hides it from the picker for new cases.
        Historical cases keep pointing at it, so past reporting is untouched.
        Duplicate names are rejected by the database regardless of
        capitalisation or spacing.
      </p>

      <InsurerManager
        insurers={(insurers as Insurer[]) ?? []}
        caseCounts={caseCounts}
      />
    </div>
  );
}
