import { describe, it, expect } from "vitest";
import {
  addDays,
  businessDatesInMonth,
  daysBetween,
  daysInMonth,
  describeWhen,
  formatSgDate,
  formatSgTime,
  formatSgWhen,
  isOnTime,
  isWithinEditWindow,
  monthBounds,
  parseBusinessDate,
  requiredDaysInMonth,
  sgDateTimeToInstant,
  sgDeadline,
  sgToday,
  toSgDateString,
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

describe("turning a form's date and time into an instant", () => {
  it("reads the time as Singapore, not as the server's timezone", () => {
    // 2pm in Singapore is 6am UTC. If this were interpreted locally on a
    // Netlify function in us-east-1, the session would be stored eleven hours
    // out and every reminder would fire on the wrong day.
    const at = sgDateTimeToInstant("2026-08-05", "14:00");
    expect(at?.toISOString()).toBe("2026-08-05T06:00:00.000Z");
  });

  it("handles a morning session", () => {
    const at = sgDateTimeToInstant("2026-08-05", "09:30");
    expect(at?.toISOString()).toBe("2026-08-05T01:30:00.000Z");
  });

  it("crosses back over the UTC date boundary before 8am", () => {
    // 7am Singapore is 11pm UTC the PREVIOUS day - the boundary that catches
    // every naive date implementation.
    const at = sgDateTimeToInstant("2026-08-05", "07:00");
    expect(at?.toISOString()).toBe("2026-08-04T23:00:00.000Z");
  });

  it("round-trips back to the same wall clock", () => {
    const at = sgDateTimeToInstant("2026-12-31", "23:45");
    expect(toSgDateString(at!)).toBe("2026-12-31");
    expect(formatSgTime(at!)).toMatch(/11:45/);
  });

  it("refuses malformed input rather than returning an invalid date", () => {
    // Month 13 would otherwise roll over into January 2027 rather than fail.
    expect(sgDateTimeToInstant("2026-13-01", "10:00")).toBeNull();
    // 31 February would roll into March.
    expect(sgDateTimeToInstant("2026-02-31", "10:00")).toBeNull();
    expect(sgDateTimeToInstant("05/08/2026", "10:00")).toBeNull();
    expect(sgDateTimeToInstant("2026-08-05", "2pm")).toBeNull();
    expect(sgDateTimeToInstant("2026-08-05", "25:00")).toBeNull();
    expect(sgDateTimeToInstant("2026-08-05", "10:71")).toBeNull();
  });
});

describe("describing when something is", () => {
  const now = new Date("2026-08-05T02:00:00Z"); // 10am Singapore

  it("says Today for later the same day", () => {
    const at = sgDateTimeToInstant("2026-08-05", "14:00")!;
    expect(describeWhen(at, now)).toMatch(/^Today at /);
  });

  it("says Tomorrow for the next calendar day", () => {
    const at = sgDateTimeToInstant("2026-08-06", "09:00")!;
    expect(describeWhen(at, now)).toMatch(/^Tomorrow at /);
  });

  it("says Tomorrow late at night, not 'in 10 hours'", () => {
    // 11pm Singapore, session at 9am the next morning. Under 24 hours away,
    // but the word people expect is still "tomorrow".
    const lateTonight = new Date("2026-08-05T15:00:00Z");
    const at = sgDateTimeToInstant("2026-08-06", "09:00")!;
    expect(describeWhen(at, lateTonight)).toMatch(/^Tomorrow at /);
  });

  it("names the weekday within the week", () => {
    const at = sgDateTimeToInstant("2026-08-08", "14:00")!;
    expect(describeWhen(at, now)).toMatch(/^Saturday at /);
  });

  it("falls back to a full date further out", () => {
    const at = sgDateTimeToInstant("2026-09-20", "14:00")!;
    expect(describeWhen(at, now)).toMatch(/Sept? 2026 at /);
  });
});

describe("wording a moment for a notification", () => {
  it("reads as a person would say it, in Singapore time", () => {
    // The exact case that reached a real phone: booked for 3pm Singapore,
    // stored as 07:00 UTC, and shown as the raw ISO string - unreadable, and
    // eight hours off the time the person was actually given.
    const at = new Date("2026-07-31T07:00:00Z");
    expect(formatSgWhen(at)).toBe("Fri, 31 Jul, 3:00 pm");
  });

  it("never emits anything resembling an ISO timestamp", () => {
    for (const iso of [
      "2026-07-31T07:00:00Z",
      "2026-01-01T16:00:00Z",
      "2026-12-31T23:59:00Z",
    ]) {
      const label = formatSgWhen(iso);
      expect(label).not.toMatch(/T\d{2}:\d{2}/);
      expect(label).not.toMatch(/\+00:00|Z$/);
      expect(label).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });

  it("uses the Singapore date, not the UTC one", () => {
    // 4pm UTC on 1 January is midnight on the 2nd in Singapore.
    expect(formatSgWhen("2026-01-01T16:00:00Z")).toMatch(/2 Jan/);
  });

  it("accepts a string or a Date", () => {
    const iso = "2026-07-31T07:00:00Z";
    expect(formatSgWhen(iso)).toBe(formatSgWhen(new Date(iso)));
  });

  it("returns nothing rather than 'Invalid Date' for rubbish", () => {
    expect(formatSgWhen("not a date")).toBe("");
  });
});
