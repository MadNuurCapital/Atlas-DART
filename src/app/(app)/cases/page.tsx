import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/app-shell/phase-placeholder";

export const metadata: Metadata = { title: "Cases" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Case Tracker"
      phase="Phase 3"
      description="Signed cases, APE and GR, with search by client and filtering by month. Cancelling removes a case from totals without losing the record."
    />
  );
}
