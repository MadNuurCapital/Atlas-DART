import { describe, it, expect, beforeAll } from "vitest";
import ExcelJS from "exceljs";
import {
  buildWorkbook,
  workbookToBuffer,
  exportFilename,
  type ExportData,
} from "@/lib/export/workbook";
import { EXCEL_CURRENCY_FORMAT, EXCEL_PERCENT_FORMAT } from "@/lib/constants";

function fixture(overrides: Partial<ExportData> = {}): ExportData {
  return {
    monthLabel: "Mar 2026",
    year: 2026,
    month: 3,
    generatedAt: new Date("2026-04-01T02:00:00Z"),
    generatedBy: "Director",
    scopeLabel: "Whole Team",

    dailyRows: [
      {
        businessDate: "2026-03-02",
        consultant: "Ahmad",
        dials: 30,
        talkedTo: 12,
        ao: 2,
        ac: 1,
        fu: 3,
        n: 1,
        campaignStatus: "running",
        signedCases: 1,
        activeGr: 1500.5,
        inOffice: true,
        status: "Submitted (on time)",
        // 15:30 UTC is 23:30 in Singapore, on the same day.
        firstSubmittedAt: "2026-03-02T15:30:00Z",
        lastSubmittedAt: "2026-03-02T15:45:00Z",
        revisionCount: 1,
      },
      {
        businessDate: "2026-03-03",
        consultant: "Siti",
        dials: 0,
        talkedTo: 0,
        ao: 0,
        ac: 0,
        fu: 0,
        n: 0,
        campaignStatus: "paused",
        signedCases: 0,
        activeGr: 0,
        inOffice: false,
        status: "Submitted (late)",
        firstSubmittedAt: "2026-03-04T02:00:00Z",
        lastSubmittedAt: "2026-03-04T02:00:00Z",
        revisionCount: 0,
      },
    ],

    appointmentRows: [
      {
        businessDate: "2026-03-02",
        consultant: "Ahmad",
        prospectName: "Mr Tan",
        appointmentType: "opening",
        note: "Referred by a client",
      },
    ],

    caseRows: [
      {
        dateSubmitted: "2026-03-02",
        dateIncepted: "2026-03-20",
        consultant: "Ahmad",
        clientName: "Mr Tan",
        insurer: "AIA Singapore",
        policyName: "Protect Plus",
        policyType: "Term",
        ape: 1200,
        gr: 1500.5,
        status: "active",
        cancelledAt: null,
        cancellationReason: null,
      },
      {
        dateSubmitted: "2026-03-05",
        dateIncepted: null,
        consultant: "Siti",
        clientName: "Mrs Lim",
        insurer: "Great Eastern Life",
        policyName: "Wealth Builder",
        policyType: "ILP",
        ape: 5000,
        gr: 2500,
        status: "cancelled",
        cancelledAt: "2026-03-18T04:00:00Z",
        cancellationReason: "Client cancelled during free-look",
      },
    ],

    targetRows: [
      {
        consultant: "Ahmad",
        monthlyTarget: 10000,
        monthToDateGr: 1500.5,
        monthlyShortfall: 8499.5,
        monthlyAchievement: 0.15005,
        yearlyTarget: 120000,
        yearToDateGr: 1500.5,
        yearlyShortfall: 118499.5,
        yearlyAchievement: 0.0125,
      },
      {
        // Nobody has set a target for Siti. Blank, never zero.
        consultant: "Siti",
        monthlyTarget: null,
        monthToDateGr: 0,
        monthlyShortfall: null,
        monthlyAchievement: null,
        yearlyTarget: null,
        yearToDateGr: 0,
        yearlyShortfall: null,
        yearlyAchievement: null,
      },
    ],

    complianceRows: [
      {
        consultant: "Ahmad",
        requiredDays: 31,
        submittedDays: 30,
        onTimeDays: 28,
        lateDays: 2,
        missingDays: 1,
        compliance: 30 / 31,
      },
    ],

    caseMixRows: [
      {
        consultant: "Ahmad",
        policyType: "Term",
        caseCount: 1,
        ape: 1200,
        gr: 1500.5,
      },
      {
        consultant: "Ahmad",
        policyType: "ILP",
        caseCount: 2,
        ape: 8000,
        gr: 4000,
      },
    ],

    ...overrides,
  };
}

describe("monthly workbook", () => {
  let wb: ExcelJS.Workbook;

  beforeAll(async () => {
    wb = await buildWorkbook(fixture());
  });

  it("creates exactly six worksheets, in the agreed order", () => {
    expect(wb.worksheets.map((s) => s.name)).toEqual([
      "Daily Team Summary",
      "Appointment Details",
      "Case Tracker",
      "Targets and Shortfall",
      "Submission Compliance",
      "Case Mix by Category",
    ]);
  });

  it("writes the Daily Team Summary columns the specification asks for", () => {
    const sheet = wb.getWorksheet("Daily Team Summary")!;
    const headers = sheet.getRow(1).values as (string | undefined)[];
    expect(headers).toContain("Date");
    expect(headers).toContain("Consultant");
    expect(headers).toContain("D");
    expect(headers).toContain("TT");
    expect(headers).toContain("Active GR");
    expect(headers).toContain("Revision Count");
  });

  it("writes GR as a real number, not a formatted string", () => {
    const sheet = wb.getWorksheet("Daily Team Summary")!;
    const cell = sheet.getRow(2).getCell("gr");
    expect(typeof cell.value).toBe("number");
    expect(cell.value).toBe(1500.5);
    expect(cell.numFmt).toBe(EXCEL_CURRENCY_FORMAT);
  });

  it("writes percentages as ratios with a percent format", () => {
    const sheet = wb.getWorksheet("Targets and Shortfall")!;
    const cell = sheet.getRow(2).getCell("mPct");
    // 0.15005 formatted as 0.0% renders "15.0%" - storing 15.005 would render
    // 1500.5%, which is the classic way this goes wrong.
    expect(cell.value).toBeCloseTo(0.15005);
    expect(cell.numFmt).toBe(EXCEL_PERCENT_FORMAT);
  });

  it("leaves a missing target blank rather than writing a zero", () => {
    const sheet = wb.getWorksheet("Targets and Shortfall")!;
    const row = sheet.getRow(3);
    expect(row.getCell("consultant").value).toBe("Siti");
    // A zero target and no target must not read the same in a meeting.
    expect(row.getCell("mTarget").value ?? null).toBeNull();
    expect(row.getCell("yTarget").value ?? null).toBeNull();
    expect(row.getCell("mPct").value ?? null).toBeNull();
  });

  it("writes dates as real dates", () => {
    const sheet = wb.getWorksheet("Daily Team Summary")!;
    const cell = sheet.getRow(2).getCell("date");
    expect(cell.value).toBeInstanceOf(Date);
    expect((cell.value as Date).toISOString().slice(0, 10)).toBe("2026-03-02");
  });

  it("writes submission times in Singapore time, not UTC", () => {
    const sheet = wb.getWorksheet("Daily Team Summary")!;
    const cell = sheet.getRow(2).getCell("first");
    const value = cell.value as Date;
    // 15:30 UTC is 23:30 Singapore. Excel has no timezone, so the wall clock
    // written must already be Singapore's.
    expect(value.getUTCHours()).toBe(23);
    expect(value.getUTCMinutes()).toBe(30);
    expect(value.toISOString().slice(0, 10)).toBe("2026-03-02");
  });

  it("keeps a cancelled case with its reason and cancelled date", () => {
    const sheet = wb.getWorksheet("Case Tracker")!;
    const row = sheet.getRow(3);
    expect(row.getCell("client").value).toBe("Mrs Lim");
    expect(row.getCell("status").value).toBe("Cancelled");
    expect(row.getCell("reason").value).toMatch(/free-look/i);
    expect(row.getCell("cancelled").value).toBeInstanceOf(Date);
    // The GR is still recorded on the row - it simply never counts anywhere.
    expect(row.getCell("gr").value).toBe(2500);
  });

  it("leaves the inception date blank for a pending case", () => {
    const sheet = wb.getWorksheet("Case Tracker")!;
    expect(sheet.getRow(3).getCell("incepted").value ?? null).toBeNull();
  });

  it("builds the category cross-tab with a column pair per policy type", () => {
    const sheet = wb.getWorksheet("Case Mix by Category")!;
    const headers = sheet.getRow(1).values as (string | undefined)[];
    expect(headers).toContain("Term Count");
    expect(headers).toContain("Term APE");
    expect(headers).toContain("ILP Count");
    expect(headers).toContain("A&H Count");
    expect(headers).toContain("Total Cases");

    const row = sheet.getRow(2);
    expect(row.getCell("consultant").value).toBe("Ahmad");
    expect(row.getCell("Term_count").value).toBe(1);
    expect(row.getCell("ILP_count").value).toBe(2);
    // A category with nothing in it is a zero, not a blank, in the cross-tab.
    expect(row.getCell("GI_count").value).toBe(0);
    expect(row.getCell("total_count").value).toBe(3);
    expect(row.getCell("total_ape").value).toBe(9200);
  });

  it("reconciles the case sheet against the daily GR total", () => {
    const daily = wb.getWorksheet("Daily Team Summary")!;
    const cases = wb.getWorksheet("Case Tracker")!;

    let dailyGr = 0;
    daily.eachRow({ includeEmpty: false }, (row, i) => {
      if (i === 1) return;
      dailyGr += Number(row.getCell("gr").value ?? 0);
    });

    let activeCaseGr = 0;
    cases.eachRow({ includeEmpty: false }, (row, i) => {
      if (i === 1) return;
      if (row.getCell("status").value !== "Active") return;
      activeCaseGr += Number(row.getCell("gr").value ?? 0);
    });

    // The cancelled 2500 must not appear in either total.
    expect(dailyGr).toBe(1500.5);
    expect(activeCaseGr).toBe(1500.5);
  });

  it("survives a month with no data at all", async () => {
    const empty = await buildWorkbook(
      fixture({
        dailyRows: [],
        appointmentRows: [],
        caseRows: [],
        targetRows: [],
        complianceRows: [],
        caseMixRows: [],
      }),
    );
    expect(empty.worksheets).toHaveLength(6);
    for (const sheet of empty.worksheets) {
      // Header row only.
      expect(sheet.rowCount).toBeLessThanOrEqual(1);
    }
  });

  it("produces a readable xlsx buffer", async () => {
    const buffer = await workbookToBuffer(wb);
    expect(buffer.byteLength).toBeGreaterThan(1000);
    // xlsx is a zip; "PK" is the local file header signature.
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");

    const reloaded = new ExcelJS.Workbook();
    // ExcelJS ships its own Buffer typing, which TypeScript does not consider
    // identical to Node's. The value is a genuine Buffer either way.
    await reloaded.xlsx.load(
      buffer as unknown as Parameters<typeof reloaded.xlsx.load>[0],
    );
    expect(reloaded.worksheets.map((s) => s.name)).toContain("Case Tracker");
  });
});

describe("export filename", () => {
  it("names the file by period and scope", () => {
    expect(exportFilename(2026, 3, "Whole Team")).toBe(
      "DART-Report-2026-03-Whole-Team.xlsx",
    );
  });

  it("pads a single-digit month", () => {
    expect(exportFilename(2026, 9, "Ahmad")).toContain("2026-09");
  });

  it("strips characters that break a download header", () => {
    const name = exportFilename(2026, 3, 'Ahmad "bin" /Ismail/');
    expect(name).not.toMatch(/["/\\]/);
    expect(name.endsWith(".xlsx")).toBe(true);
  });
});
