import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The export must fail loudly rather than quietly under-report.
 *
 * Every query in gather.ts used to end in `?? []`, so a permission problem or
 * a dropped connection produced a workbook that opened perfectly and was
 * simply missing rows. Nobody re-checks a report that looks fine, which makes
 * this the most dangerous shape of bug in the whole application.
 */

type Result = { data: unknown[]; error: { message: string } | null; count?: number };

/** Per-table canned results, keyed by what gather.ts asks for. */
const results = new Map<string, Result>();

function ok(rows: unknown[] = [], count?: number): Result {
  return { data: rows, error: null, count: count ?? rows.length };
}

/**
 * A stand-in for the PostgREST query builder.
 *
 * Every filter method returns the builder again, and awaiting it yields the
 * canned result - which is exactly the shape gather.ts relies on when it puts
 * seven builders into Promise.all.
 */
function builder(result: Result) {
  const chain: Record<string, unknown> = {
    then: (resolve: (value: Result) => unknown) => Promise.resolve(result).then(resolve),
  };
  for (const method of ["select", "eq", "is", "gte", "lte", "order", "limit"]) {
    chain[method] = () => chain;
  }
  return chain;
}

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => builder(results.get(table) ?? ok()),
    rpc: (fn: string) => builder(results.get(fn) ?? ok()),
  }),
}));

const { gatherExportData } = await import("@/lib/export/gather");

const OPTS = {
  year: 2026,
  month: 3,
  consultantId: null,
  generatedBy: "Test Admin",
};

beforeEach(() => {
  results.clear();
});

describe("gathering export data", () => {
  it("builds a report when every query succeeds", async () => {
    const data = await gatherExportData(OPTS);
    expect(data.year).toBe(2026);
    expect(data.month).toBe(3);
  });

  it.each([
    ["v_daily_consultant_summary", "the daily summary"],
    ["appointment_activities", "appointments"],
    ["cases", "cases"],
    ["v_target_shortfall", "targets"],
    ["monthly_compliance", "compliance"],
    ["v_case_mix_by_category", "the category mix"],
    ["profiles", "consultant names"],
  ])("refuses to build a report when %s fails", async (source, described) => {
    results.set(source, {
      data: [],
      error: { message: "permission denied" },
      count: 0,
    });

    await expect(gatherExportData(OPTS)).rejects.toThrow(
      new RegExp(`could not read ${described}`, "i"),
    );
  });

  it("refuses when the database returned fewer rows than it counted", async () => {
    // What a PostgREST max-rows cap looks like: a successful response that is
    // quietly missing the tail of the month.
    results.set("cases", ok([{ id: "1" }, { id: "2" }], 4_000));

    await expect(gatherExportData(OPTS)).rejects.toThrow(
      /read only 2 of 4000 cases/i,
    );
  });

  it("accepts a count that matches what came back", async () => {
    results.set("cases", ok([{ id: "1" }, { id: "2" }], 2));
    await expect(gatherExportData(OPTS)).resolves.toBeTruthy();
  });

  it("does not object when the driver reports no count at all", async () => {
    results.set("cases", { data: [{ id: "1" }], error: null });
    await expect(gatherExportData(OPTS)).resolves.toBeTruthy();
  });
});
