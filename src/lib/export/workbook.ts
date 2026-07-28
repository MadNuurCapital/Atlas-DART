import ExcelJS from "exceljs";
import {
  EXCEL_CURRENCY_FORMAT,
  EXCEL_DATE_FORMAT,
  EXCEL_PERCENT_FORMAT,
  APPOINTMENT_TYPE_LABELS,
  CAMPAIGN_STATUS_LABELS,
  POLICY_TYPES,
  type PolicyType,
} from "@/lib/constants";

/**
 * Monthly meeting report.
 *
 * Six worksheets. Every figure is written as a real number or a real date with
 * a number format applied - never a pre-formatted string - so the recipient can
 * sort, filter and total the workbook themselves.
 *
 * The data handed in here comes from the same views the dashboard reads, which
 * is what stops the export and the screen ever disagreeing.
 */

export type ExportData = {
  monthLabel: string;
  year: number;
  month: number;
  generatedAt: Date;
  generatedBy: string;
  scopeLabel: string;
  dailyRows: DailyRow[];
  appointmentRows: AppointmentRow[];
  caseRows: CaseRow[];
  targetRows: TargetRow[];
  complianceRows: ComplianceRow[];
  caseMixRows: CaseMixRow[];
};

export type DailyRow = {
  businessDate: string;
  consultant: string;
  dials: number;
  talkedTo: number;
  ao: number;
  ac: number;
  fu: number;
  n: number;
  campaignStatus: string | null;
  signedCases: number;
  activeGr: number;
  inOffice: boolean | null;
  status: string;
  firstSubmittedAt: string | null;
  lastSubmittedAt: string | null;
  revisionCount: number;
};

export type AppointmentRow = {
  businessDate: string;
  consultant: string;
  prospectName: string;
  appointmentType: string;
  note: string | null;
};

export type CaseRow = {
  dateSubmitted: string;
  dateIncepted: string | null;
  consultant: string;
  clientName: string;
  insurer: string;
  policyName: string;
  policyType: string;
  ape: number;
  gr: number;
  status: string;
  cancelledAt: string | null;
  cancellationReason: string | null;
};

export type TargetRow = {
  consultant: string;
  monthlyTarget: number | null;
  monthToDateGr: number;
  monthlyShortfall: number | null;
  monthlyAchievement: number | null;
  yearlyTarget: number | null;
  yearToDateGr: number;
  yearlyShortfall: number | null;
  yearlyAchievement: number | null;
};

export type ComplianceRow = {
  consultant: string;
  requiredDays: number;
  submittedDays: number;
  onTimeDays: number;
  lateDays: number;
  missingDays: number;
  compliance: number;
};

export type CaseMixRow = {
  consultant: string;
  policyType: PolicyType;
  caseCount: number;
  ape: number;
  gr: number;
};

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1E7FA6" },
};

/** A date-only value as a real Date, so Excel treats it as a date. */
function toDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A timestamp rendered in Singapore time but written as a naive Date.
 *
 * Excel has no timezone concept: a Date is stored as a wall-clock serial. If we
 * wrote the raw UTC instant, a 9pm Singapore submission would read as 1pm.
 */
function toSgWallClock(value: string | null): Date | null {
  if (!value) return null;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instant);

  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);

  return new Date(
    Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour") % 24,
      get("minute"),
      get("second"),
    ),
  );
}

function addSheet(
  wb: ExcelJS.Workbook,
  name: string,
  columns: Partial<ExcelJS.Column>[],
): ExcelJS.Worksheet {
  const sheet = wb.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = columns;

  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = HEADER_FILL;
  header.alignment = { vertical: "middle" };
  header.height = 20;

  return sheet;
}

function autoFilter(sheet: ExcelJS.Worksheet) {
  if (sheet.rowCount < 1 || sheet.columnCount < 1) return;
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.columnCount },
  };
}

export async function buildWorkbook(data: ExportData): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "DART & Case Tracker";
  wb.created = data.generatedAt;

  // ---- 1. Daily Team Summary -------------------------------------------
  const daily = addSheet(wb, "Daily Team Summary", [
    { header: "Date", key: "date", width: 12, style: { numFmt: EXCEL_DATE_FORMAT } },
    { header: "Consultant", key: "consultant", width: 22 },
    { header: "D", key: "d", width: 6 },
    { header: "TT", key: "tt", width: 6 },
    { header: "AO", key: "ao", width: 6 },
    { header: "AC", key: "ac", width: 6 },
    { header: "FU", key: "fu", width: 6 },
    { header: "N", key: "n", width: 6 },
    { header: "Campaign Status", key: "campaign", width: 16 },
    { header: "Signed Cases", key: "cases", width: 13 },
    { header: "Active GR", key: "gr", width: 14, style: { numFmt: EXCEL_CURRENCY_FORMAT } },
    { header: "Office", key: "office", width: 9 },
    { header: "Submission Status", key: "status", width: 17 },
    { header: "First Submitted At", key: "first", width: 19, style: { numFmt: "dd/mm/yyyy hh:mm" } },
    { header: "Last Updated At", key: "last", width: 19, style: { numFmt: "dd/mm/yyyy hh:mm" } },
    { header: "Revision Count", key: "revisions", width: 14 },
  ]);

  for (const row of data.dailyRows) {
    daily.addRow({
      date: toDate(row.businessDate),
      consultant: row.consultant,
      d: row.dials,
      tt: row.talkedTo,
      ao: row.ao,
      ac: row.ac,
      fu: row.fu,
      n: row.n,
      campaign: row.campaignStatus
        ? (CAMPAIGN_STATUS_LABELS[
            row.campaignStatus as keyof typeof CAMPAIGN_STATUS_LABELS
          ] ?? row.campaignStatus)
        : "",
      cases: row.signedCases,
      gr: row.activeGr,
      office: row.inOffice === null ? "" : row.inOffice ? "Yes" : "No",
      status: row.status,
      first: toSgWallClock(row.firstSubmittedAt),
      last: toSgWallClock(row.lastSubmittedAt),
      revisions: row.revisionCount,
    });
  }
  autoFilter(daily);

  // ---- 2. Appointment Details ------------------------------------------
  const appts = addSheet(wb, "Appointment Details", [
    { header: "Date", key: "date", width: 12, style: { numFmt: EXCEL_DATE_FORMAT } },
    { header: "Consultant", key: "consultant", width: 22 },
    { header: "Prospect Name", key: "prospect", width: 24 },
    { header: "Appointment Type", key: "type", width: 22 },
    { header: "Note", key: "note", width: 40 },
  ]);

  for (const row of data.appointmentRows) {
    appts.addRow({
      date: toDate(row.businessDate),
      consultant: row.consultant,
      prospect: row.prospectName,
      type:
        APPOINTMENT_TYPE_LABELS[
          row.appointmentType as keyof typeof APPOINTMENT_TYPE_LABELS
        ] ?? row.appointmentType,
      note: row.note ?? "",
    });
  }
  autoFilter(appts);

  // ---- 3. Case Tracker --------------------------------------------------
  const cases = addSheet(wb, "Case Tracker", [
    { header: "Date Submitted", key: "submitted", width: 15, style: { numFmt: EXCEL_DATE_FORMAT } },
    { header: "Date Incepted", key: "incepted", width: 15, style: { numFmt: EXCEL_DATE_FORMAT } },
    { header: "Consultant", key: "consultant", width: 22 },
    { header: "Client Name", key: "client", width: 24 },
    { header: "Insurer", key: "insurer", width: 22 },
    { header: "Policy Name", key: "policy", width: 26 },
    { header: "Category", key: "category", width: 12 },
    { header: "APE", key: "ape", width: 14, style: { numFmt: EXCEL_CURRENCY_FORMAT } },
    { header: "GR", key: "gr", width: 14, style: { numFmt: EXCEL_CURRENCY_FORMAT } },
    { header: "Status", key: "status", width: 11 },
    { header: "Cancelled Date", key: "cancelled", width: 15, style: { numFmt: EXCEL_DATE_FORMAT } },
    { header: "Cancellation Reason", key: "reason", width: 40 },
  ]);

  for (const row of data.caseRows) {
    cases.addRow({
      submitted: toDate(row.dateSubmitted),
      incepted: toDate(row.dateIncepted),
      consultant: row.consultant,
      client: row.clientName,
      insurer: row.insurer,
      policy: row.policyName,
      category: row.policyType,
      ape: row.ape,
      gr: row.gr,
      status: row.status === "active" ? "Active" : "Cancelled",
      cancelled: toDate(row.cancelledAt),
      reason: row.cancellationReason ?? "",
    });
  }
  autoFilter(cases);

  // ---- 4. Targets and Shortfall ----------------------------------------
  const targets = addSheet(wb, "Targets and Shortfall", [
    { header: "Consultant", key: "consultant", width: 22 },
    { header: "Monthly Target", key: "mTarget", width: 15, style: { numFmt: EXCEL_CURRENCY_FORMAT } },
    { header: "Month-to-Date GR", key: "mGr", width: 17, style: { numFmt: EXCEL_CURRENCY_FORMAT } },
    { header: "Monthly Shortfall", key: "mShort", width: 17, style: { numFmt: EXCEL_CURRENCY_FORMAT } },
    { header: "Monthly Achievement %", key: "mPct", width: 21, style: { numFmt: EXCEL_PERCENT_FORMAT } },
    { header: "Yearly Target", key: "yTarget", width: 15, style: { numFmt: EXCEL_CURRENCY_FORMAT } },
    { header: "Year-to-Date GR", key: "yGr", width: 16, style: { numFmt: EXCEL_CURRENCY_FORMAT } },
    { header: "Yearly Shortfall", key: "yShort", width: 16, style: { numFmt: EXCEL_CURRENCY_FORMAT } },
    { header: "Yearly Achievement %", key: "yPct", width: 20, style: { numFmt: EXCEL_PERCENT_FORMAT } },
  ]);

  for (const row of data.targetRows) {
    // A blank cell rather than a zero where no target exists - a zero target
    // and no target are different things and must not read the same.
    targets.addRow({
      consultant: row.consultant,
      mTarget: row.monthlyTarget,
      mGr: row.monthToDateGr,
      mShort: row.monthlyShortfall,
      mPct: row.monthlyAchievement,
      yTarget: row.yearlyTarget,
      yGr: row.yearToDateGr,
      yShort: row.yearlyShortfall,
      yPct: row.yearlyAchievement,
    });
  }
  autoFilter(targets);

  // ---- 5. Submission Compliance ----------------------------------------
  const compliance = addSheet(wb, "Submission Compliance", [
    { header: "Consultant", key: "consultant", width: 22 },
    { header: "Required Days", key: "required", width: 14 },
    { header: "Submitted Days", key: "submitted", width: 15 },
    { header: "On-Time Days", key: "onTime", width: 14 },
    { header: "Late Days", key: "late", width: 11 },
    { header: "Missing Days", key: "missing", width: 13 },
    { header: "Compliance %", key: "pct", width: 14, style: { numFmt: EXCEL_PERCENT_FORMAT } },
  ]);

  for (const row of data.complianceRows) {
    compliance.addRow({
      consultant: row.consultant,
      required: row.requiredDays,
      submitted: row.submittedDays,
      onTime: row.onTimeDays,
      late: row.lateDays,
      missing: row.missingDays,
      pct: row.compliance,
    });
  }
  autoFilter(compliance);

  // ---- 6. Case Mix by Category -----------------------------------------
  // Reproduces the cross-tab from the original Numbers workbook: one row per
  // consultant, then Counts and APE repeated for every policy type.
  const mixColumns: Partial<ExcelJS.Column>[] = [
    { header: "Consultant", key: "consultant", width: 22 },
  ];
  for (const type of POLICY_TYPES) {
    mixColumns.push({ header: `${type} Count`, key: `${type}_count`, width: 12 });
    mixColumns.push({
      header: `${type} APE`,
      key: `${type}_ape`,
      width: 14,
      style: { numFmt: EXCEL_CURRENCY_FORMAT },
    });
  }
  mixColumns.push({ header: "Total Cases", key: "total_count", width: 12 });
  mixColumns.push({
    header: "Total APE",
    key: "total_ape",
    width: 14,
    style: { numFmt: EXCEL_CURRENCY_FORMAT },
  });
  mixColumns.push({
    header: "Total GR",
    key: "total_gr",
    width: 14,
    style: { numFmt: EXCEL_CURRENCY_FORMAT },
  });

  const mix = addSheet(wb, "Case Mix by Category", mixColumns);

  const consultantsInMix = [
    ...new Set(data.caseMixRows.map((r) => r.consultant)),
  ].sort();

  for (const consultant of consultantsInMix) {
    const rows = data.caseMixRows.filter((r) => r.consultant === consultant);
    const record: Record<string, string | number> = { consultant };

    for (const type of POLICY_TYPES) {
      const found = rows.find((r) => r.policyType === type);
      record[`${type}_count`] = found ? found.caseCount : 0;
      record[`${type}_ape`] = found ? found.ape : 0;
    }

    record.total_count = rows.reduce((s, r) => s + r.caseCount, 0);
    record.total_ape = rows.reduce((s, r) => s + r.ape, 0);
    record.total_gr = rows.reduce((s, r) => s + r.gr, 0);

    mix.addRow(record);
  }
  autoFilter(mix);

  return wb;
}

export async function workbookToBuffer(
  wb: ExcelJS.Workbook,
): Promise<Buffer> {
  const data = await wb.xlsx.writeBuffer();
  return Buffer.from(data);
}

/** e.g. DART-Report-2026-03-Whole-Team.xlsx */
export function exportFilename(
  year: number,
  month: number,
  scopeLabel: string,
): string {
  const safeScope = scopeLabel.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `DART-Report-${year}-${String(month).padStart(2, "0")}-${safeScope}.xlsx`;
}
