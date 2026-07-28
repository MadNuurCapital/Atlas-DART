import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/app-shell/phase-placeholder";

export const metadata: Metadata = { title: "Insurers" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Insurers"
      phase="Phase 3"
      description="Rename, retire and merge insurers so reporting stays consistent as consultants add their own."
    />
  );
}
