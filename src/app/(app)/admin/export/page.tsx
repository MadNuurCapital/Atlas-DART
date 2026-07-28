import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/app-shell/phase-placeholder";

export const metadata: Metadata = { title: "Export" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Monthly export"
      phase="Phase 5"
      description="Download the six-sheet monthly meeting report as an Excel workbook."
    />
  );
}
