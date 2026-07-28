import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/app-shell/phase-placeholder";

export const metadata: Metadata = { title: "Daily board" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Daily board"
      phase="Phase 4"
      description="One row per person for any chosen date, updating live as submissions arrive."
    />
  );
}
