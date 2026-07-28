import type { Metadata } from "next";
import { requireProfile } from "@/lib/auth";
import { fetchCases } from "@/lib/cases-query";
import { CaseList } from "@/components/cases/case-list";

export const metadata: Metadata = { title: "Cases" };
export const dynamic = "force-dynamic";

export default async function CasesPage() {
  const profile = await requireProfile();
  const { cases, insurers, truncated } = await fetchCases();

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Case Tracker</h1>
        <p className="text-sm text-muted-foreground">
          A case counts from the day it was submitted to the insurer.
          Cancelling removes it from your totals without losing the record.
        </p>
      </div>

      <CaseList
        cases={cases}
        insurers={insurers}
        isAdmin={profile.role === "admin"}
        truncated={truncated}
      />
    </div>
  );
}
