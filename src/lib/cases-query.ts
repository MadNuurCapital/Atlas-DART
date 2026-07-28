import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { CaseWithInsurer } from "@/components/cases/case-list";
import type { Insurer } from "@/types/database";

type CaseJoinRow = {
  id: string;
  consultant_id: string;
  date_submitted: string;
  date_incepted: string | null;
  client_name: string;
  insurer_id: string;
  policy_name: string;
  policy_type: string;
  ape_amount: number;
  gr_amount: number;
  status: string;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  insurers: { name: string } | null;
  profiles: { full_name: string } | null;
};

/**
 * Cases with their insurer and consultant names flattened onto the row.
 *
 * No user filter is applied here on purpose: Row Level Security already limits
 * a consultant to their own cases and lets an admin see everything, so adding
 * a WHERE clause would only duplicate - and risk contradicting - the policy.
 */
export async function fetchCases(): Promise<{
  cases: CaseWithInsurer[];
  insurers: Insurer[];
}> {
  const supabase = await createClient();

  const [{ data: caseRows }, { data: insurerRows }] = await Promise.all([
    supabase
      .from("cases")
      .select(
        "*, insurers ( name ), profiles!cases_consultant_id_fkey ( full_name )",
      )
      .order("date_submitted", { ascending: false }),
    supabase
      .from("insurers")
      .select("*")
      .eq("active", true)
      .order("name", { ascending: true }),
  ]);

  const cases = ((caseRows ?? []) as unknown as CaseJoinRow[]).map((row) => ({
    ...row,
    ape_amount: Number(row.ape_amount),
    gr_amount: Number(row.gr_amount),
    insurer_name: row.insurers?.name ?? "Unknown insurer",
    consultant_name: row.profiles?.full_name,
  })) as CaseWithInsurer[];

  return { cases, insurers: (insurerRows as Insurer[]) ?? [] };
}
