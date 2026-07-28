import "server-only";

import { createClient } from "@/lib/supabase/server";
import { monthBounds, formatSgDate } from "@/lib/sg-date";
import type { ExportData } from "@/lib/export/workbook";
import type { PolicyType } from "@/lib/constants";
import type {
  DailyConsultantSummary,
  MonthlyComplianceRow,
  TargetShortfall,
} from "@/types/database";

/**
 * Gather everything the monthly workbook needs.
 *
 * Reads the same views the dashboard reads. That is deliberate: if the export
 * built its own aggregates, the two would drift and a meeting would end in an
 * argument about which number is right.
 *
 * Row Level Security still applies - this runs as the signed-in admin - so
 * nothing here can return data the caller could not already see on screen.
 */
export async function gatherExportData(opts: {
  year: number;
  month: number;
  consultantId: string | null;
  generatedBy: string;
}): Promise<ExportData> {
  const { year, month, consultantId, generatedBy } = opts;
  const { start, end } = monthBounds(year, month);
  const supabase = await createClient();

  const scoped = <T extends { eq: (col: string, val: string) => T }>(
    query: T,
    column: string,
  ): T => (consultantId ? query.eq(column, consultantId) : query);

  const [
    dailyRes,
    apptRes,
    caseRes,
    targetRes,
    complianceRes,
    mixRes,
    profileRes,
  ] = await Promise.all([
    scoped(
      supabase
        .from("v_daily_consultant_summary")
        .select("*")
        .gte("business_date", start)
        .lte("business_date", end)
        .order("business_date", { ascending: true }),
      "user_id",
    ),
    scoped(
      supabase
        .from("appointment_activities")
        .select("*, profiles ( full_name )")
        .gte("business_date", start)
        .lte("business_date", end)
        .order("business_date", { ascending: true }),
      "user_id",
    ),
    scoped(
      supabase
        .from("cases")
        .select(
          "*, insurers ( name ), profiles!cases_consultant_id_fkey ( full_name )",
        )
        .gte("date_submitted", start)
        .lte("date_submitted", end)
        .order("date_submitted", { ascending: true }),
      "consultant_id",
    ),
    scoped(supabase.from("v_target_shortfall").select("*"), "consultant_id"),
    supabase.rpc("monthly_compliance", { p_year: year, p_month: month }),
    scoped(
      supabase
        .from("v_case_mix_by_category")
        .select("*")
        .eq("year", year)
        .eq("month", month),
      "consultant_id",
    ),
    supabase.from("profiles").select("id, full_name"),
  ]);

  const names = new Map(
    ((profileRes.data as { id: string; full_name: string }[]) ?? []).map((p) => [
      p.id,
      p.full_name,
    ]),
  );

  const daily = (dailyRes.data as DailyConsultantSummary[]) ?? [];
  const targets = (targetRes.data as TargetShortfall[]) ?? [];

  let compliance = (complianceRes.data as MonthlyComplianceRow[]) ?? [];
  if (consultantId) {
    compliance = compliance.filter((c) => c.consultant_id === consultantId);
  }

  type ApptJoin = {
    business_date: string;
    user_id: string;
    prospect_name: string;
    appointment_type: string;
    note: string | null;
    profiles: { full_name: string } | null;
  };

  type CaseJoin = {
    date_submitted: string;
    date_incepted: string | null;
    consultant_id: string;
    client_name: string;
    policy_name: string;
    policy_type: string;
    ape_amount: number;
    gr_amount: number;
    status: string;
    cancelled_at: string | null;
    cancellation_reason: string | null;
    insurers: { name: string } | null;
    profiles: { full_name: string } | null;
  };

  type MixRow = {
    consultant_id: string;
    policy_type: PolicyType;
    case_count: number;
    ape: number;
    gr: number;
  };

  const scopeLabel = consultantId
    ? (names.get(consultantId) ?? "Consultant")
    : "Whole Team";

  return {
    monthLabel: formatSgDate(start).replace(/^\w+, \d+ /, ""),
    year,
    month,
    generatedAt: new Date(),
    generatedBy,
    scopeLabel,

    dailyRows: daily.map((r) => ({
      businessDate: r.business_date,
      consultant: r.full_name,
      dials: Number(r.dials),
      talkedTo: Number(r.talked_to),
      ao: Number(r.appointments_opening),
      ac: Number(r.appointments_closing),
      fu: Number(r.appointments_follow_up),
      n: Number(r.appointments_nomination),
      campaignStatus: r.campaign_status,
      signedCases: Number(r.signed_cases),
      activeGr: Number(r.active_gr),
      inOffice: r.in_office,
      status:
        r.status === "submitted"
          ? r.on_time
            ? "Submitted (on time)"
            : "Submitted (late)"
          : "Draft",
      firstSubmittedAt: r.first_submitted_at,
      lastSubmittedAt: r.last_submitted_at,
      revisionCount: Number(r.revision_count),
    })),

    appointmentRows: ((apptRes.data as unknown as ApptJoin[]) ?? []).map((r) => ({
      businessDate: r.business_date,
      consultant: r.profiles?.full_name ?? names.get(r.user_id) ?? "",
      prospectName: r.prospect_name,
      appointmentType: r.appointment_type,
      note: r.note,
    })),

    caseRows: ((caseRes.data as unknown as CaseJoin[]) ?? []).map((r) => ({
      dateSubmitted: r.date_submitted,
      dateIncepted: r.date_incepted,
      consultant: r.profiles?.full_name ?? names.get(r.consultant_id) ?? "",
      clientName: r.client_name,
      insurer: r.insurers?.name ?? "",
      policyName: r.policy_name,
      policyType: r.policy_type,
      ape: Number(r.ape_amount),
      gr: Number(r.gr_amount),
      status: r.status,
      cancelledAt: r.cancelled_at,
      cancellationReason: r.cancellation_reason,
    })),

    targetRows: targets.map((t) => ({
      consultant: t.full_name,
      monthlyTarget: t.monthly_target === null ? null : Number(t.monthly_target),
      monthToDateGr: Number(t.month_to_date_gr),
      monthlyShortfall:
        t.monthly_shortfall === null ? null : Number(t.monthly_shortfall),
      monthlyAchievement:
        t.monthly_achievement === null ? null : Number(t.monthly_achievement),
      yearlyTarget: t.yearly_target === null ? null : Number(t.yearly_target),
      yearToDateGr: Number(t.year_to_date_gr),
      yearlyShortfall:
        t.yearly_shortfall === null ? null : Number(t.yearly_shortfall),
      yearlyAchievement:
        t.yearly_achievement === null ? null : Number(t.yearly_achievement),
    })),

    complianceRows: compliance.map((c) => ({
      consultant: c.full_name,
      requiredDays: Number(c.required_days),
      submittedDays: Number(c.submitted_days),
      onTimeDays: Number(c.on_time_days),
      lateDays: Number(c.late_days),
      missingDays: Number(c.missing_days),
      compliance: Number(c.compliance),
    })),

    caseMixRows: ((mixRes.data as unknown as MixRow[]) ?? []).map((r) => ({
      consultant: names.get(r.consultant_id) ?? "",
      policyType: r.policy_type,
      caseCount: Number(r.case_count),
      ape: Number(r.ape),
      gr: Number(r.gr),
    })),
  };
}
