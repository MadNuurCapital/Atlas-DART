import { describe, it, expect } from "vitest";
import {
  sgToday,
  toSgDateString,
  sgDeadline,
  isOnTime,
  addDays,
  daysBetween,
  isWithinEditWindow,
  daysInMonth,
  requiredDaysInMonth,
  businessDatesInMonth,
  monthBounds,
  parseBusinessDate,
  formatSgDate,
  formatSgTime,
} from "@/lib/sg-date";

describe("Singapore business date", () => {
  it("uses the Singapore calendar, not UTC", () => {
    // 22:00 UTC on 27 July is already 06:00 on 28 July in Singapore. Getting
    // this wrong would file an evening submission against the previous day.
    const instant = new Date("2026-07-27T22:00:00Z");
    expect(toSgDateString(instant)).toBe("2026-07-28");
  });

  it("handles the UTC midnight boundary", () => {
    // 23:59 UTC and 00:01 UTC land on the same Singapore date.
    expect(toSgDateString(new Date("2026-07-27T23:59:00Z"))).toBe("2026-07-28");
    expect(toSgDateString(new Date("2026-07-28T00:01:00Z"))).toBe("2026-07-28");
  });

  it("rolls over at 16:00 UTC, which is Singapore midnight", () => {
    expect(toSgDateString(new Date("2026-07-27T15:59:59Z"))).toBe("2026-07-27");
    expect(toSgDateString(new Date("2026-07-27T16:00:00Z"))).toBe("2026-07-28");
  });

  it("returns today in YYYY-MM-DD form", () => {
    expect(sgToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("rejects a malformed date", () => {
    expect(() => parseBusinessDate("27/07/2026")).toThrow(/YYYY-MM-DD/);
    expect(() => parseBusinessDate("2026-7-1")).toThrow();
  });
});

describe("deadline and on-time status", () => {
  it("places the deadline at 23:59:59.999 Singapore time", () => {
    // 23:59:59.999 SGT on 28 July is 15:59:59.999 UTC on the same day.
    expect(sgDeadline("2026-07-28").toISOString()).toBe(
      "2026-07-28T15:59:59.999Z",
    );
  });

  it("counts a submission one second before the deadline as on time", () => {
    expect(isOnTime(new Date("2026-07-28T15:59:00Z"), "2026-07-28")).toBe(true);
  });

  it("counts a submission one second after the deadline as late", () => {
    expect(isOnTime(new Date("2026-07-28T16:00:01Z"), "2026-07-28")).toBe(false);
  });

  it("counts a backfilled earlier date as late", () => {
    // Submitted on 30 July for the 27th.
    expect(isOnTime(new Date("2026-07-30T04:00:00Z"), "2026-07-27")).toBe(false);
  });

  it("treats a missing first submission as not on time", () => {
    expect(isOnTime(null, "2026-07-28")).toBe(false);
    expect(isOnTime(undefined, "2026-07-28")).toBe(false);
  });

  it("accepts an ISO string as well as a Date", () => {
    expect(isOnTime("2026-07-28T10:00:00Z", "2026-07-28")).toBe(true);
  });
});

describe("date arithmetic", () => {
  it("adds and subtracts days across a month boundary", () => {
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2026-08-01", -1)).toBe("2026-07-31");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("handles a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
  });

  it("measures whole days between dates", () => {
    expect(daysBetween("2026-07-21", "2026-07-28")).toBe(7);
    expect(daysBetween("2026-07-28", "2026-07-28")).toBe(0);
    expect(daysBetween("2026-07-29", "2026-07-28")).toBe(-1);
  });

  it("reports month bounds", () => {
    expect(monthBounds(2026, 2)).toEqual({
      start: "2026-02-01",
      end: "2026-02-28",
    });
  });
});

describe("edit window (decision D2)", () => {
  const today = "2026-07-28";

  it("allows today and the previous seven days", () => {
    expect(isWithinEditWindow("2026-07-28", today)).toBe(true);
    expect(isWithinEditWindow("2026-07-22", today)).toBe(true);
    expect(isWithinEditWindow("2026-07-21", today)).toBe(true);
  });

  it("rejects day eight", () => {
    expect(isWithinEditWindow("2026-07-20", today)).toBe(false);
  });

  it("rejects a future date", () => {
    expect(isWithinEditWindow("2026-07-29", today)).toBe(false);
  });
});

describe("required days for compliance (decision D7)", () => {
  const today = "2026-07-12";

  it("counts only the days elapsed in the current month", () => {
    expect(requiredDaysInMonth(2026, 7, today)).toBe(12);
  });

  it("counts every day of a finished month", () => {
    expect(requiredDaysInMonth(2026, 6, today)).toBe(30);
    expect(requiredDaysInMonth(2026, 5, today)).toBe(31);
  });

  it("requires nothing of a future month", () => {
    expect(requiredDaysInMonth(2026, 8, today)).toBe(0);
    expect(requiredDaysInMonth(2027, 1, today)).toBe(0);
  });

  it("lists the business dates it expects", () => {
    const dates = businessDatesInMonth(2026, 7, today);
    expect(dates).toHaveLength(12);
    expect(dates[0]).toBe("2026-07-01");
    expect(dates.at(-1)).toBe("2026-07-12");
  });

  it("includes weekends, which every consultant must still submit", () => {
    // 4 and 5 July 2026 are a Saturday and a Sunday.
    const dates = businessDatesInMonth(2026, 7, today);
    expect(dates).toContain("2026-07-04");
    expect(dates).toContain("2026-07-05");
  });
});

describe("display formatting", () => {
  it("formats a business date in Singapore", () => {
    expect(formatSgDate("2026-07-28")).toMatch(/28 Jul 2026/);
  });

  it("formats a time in Singapore, not UTC", () => {
    // 15:30 UTC is 23:30 in Singapore.
    expect(formatSgTime(new Date("2026-07-28T15:30:00Z"))).toMatch(/11:30/);
  });
});
