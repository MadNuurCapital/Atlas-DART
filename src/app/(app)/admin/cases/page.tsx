import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { fetchCases } from "@/lib/cases-query";
import { CaseList } from "@/components/cases/case-list";

export const metadata: Metadata = { title: "All cases" };
export const dynamic = "force-dynamic";

export default async function AdminCasesPage() {
  await requireAdmin();
  const { cases, insurers, truncated } = await fetchCases();

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">All cases</h1>
        <p className="text-sm text-muted-foreground">
          Every advisor&rsquo;s cases, including cancelled ones. Only you can
          restore a cancelled case.
        </p>
      </div>

      <CaseList
        cases={cases}
        insurers={insurers}
        isAdmin
        showConsultant
        canAdd={false}
        truncated={truncated}
      />
    </div>
  );
}
