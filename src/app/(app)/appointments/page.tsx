import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/app-shell/phase-placeholder";

export const metadata: Metadata = { title: "Appointments" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Appointments"
      phase="Phase 2"
      description="Add, edit and remove prospect appointments. Your daily totals are counted from these entries, never typed."
    />
  );
}
