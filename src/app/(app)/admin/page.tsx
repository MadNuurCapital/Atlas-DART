import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/app-shell/phase-placeholder";

export const metadata: Metadata = { title: "Team overview" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Team overview"
      phase="Phase 4"
      description="Live view of who has submitted today, who is missing, and the team's figures."
    />
  );
}
