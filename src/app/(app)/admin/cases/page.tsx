import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/app-shell/phase-placeholder";

export const metadata: Metadata = { title: "All cases" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="All cases"
      phase="Phase 3"
      description="Every consultant's cases, including cancelled ones, with restore."
    />
  );
}
