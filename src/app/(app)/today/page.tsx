import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/app-shell/phase-placeholder";

export const metadata: Metadata = { title: "Today" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Today's DART"
      phase="Phase 2"
      description="Dials, Talked-To, campaign status, office, and the appointments behind your AO/AC/FU/N totals."
    />
  );
}
