import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/app-shell/phase-placeholder";

export const metadata: Metadata = { title: "Targets" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Targets"
      phase="Phase 3"
      description="Yearly GR targets per consultant, with optional monthly overrides. Every change is audit-logged."
    />
  );
}
