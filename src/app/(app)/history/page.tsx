import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/app-shell/phase-placeholder";

export const metadata: Metadata = { title: "History" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Submission history"
      phase="Phase 2"
      description="Your past submissions, with the seven-day window in which you can still correct them."
    />
  );
}
