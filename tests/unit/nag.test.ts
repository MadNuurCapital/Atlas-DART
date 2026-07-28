import { describe, it, expect } from "vitest";
import {
  nagLevel,
  nagCopy,
  sgHour,
  minutesToDeadline,
  timeLeftLabel,
} from "@/lib/nag";

/** An instant, given as a Singapore wall-clock hour on 10 March 2026. */
function atSgHour(hour: number, minute = 0): Date {
  // Singapore is UTC+8, so subtract 8 to get the UTC instant.
  return new Date(
    Date.UTC(2026, 2, 10, hour - 8, minute).valueOf() +
      (hour - 8 < 0 ? 24 * 3600_000 : 0),
  );
}

describe("Singapore hour", () => {
  it("reads the Singapore clock, not the runtime's", () => {
    expect(sgHour(new Date("2026-03-10T09:00:00Z"))).toBe(17);
    expect(sgHour(new Date("2026-03-10T15:00:00Z"))).toBe(23);
    expect(sgHour(new Date("2026-03-10T16:00:00Z"))).toBe(0);
  });
});

describe("how hard to nag", () => {
  it("never nags someone who has already submitted", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      expect(nagLevel(true, atSgHour(hour))).toBe("none");
    }
  });

  it("stays quiet before 9am", () => {
    // Being chased for today's numbers at breakfast is how people learn to
    // ignore the thing entirely.
    expect(nagLevel(false, atSgHour(6))).toBe("none");
    expect(nagLevel(false, atSgHour(8))).toBe("none");
  });

  it("escalates through the day", () => {
    expect(nagLevel(false, atSgHour(9))).toBe("gentle");
    expect(nagLevel(false, atSgHour(14))).toBe("gentle");
    expect(nagLevel(false, atSgHour(15))).toBe("firm");
    expect(nagLevel(false, atSgHour(18))).toBe("firm");
    expect(nagLevel(false, atSgHour(19))).toBe("urgent");
    expect(nagLevel(false, atSgHour(21))).toBe("urgent");
    expect(nagLevel(false, atSgHour(22))).toBe("final");
    expect(nagLevel(false, atSgHour(23))).toBe("final");
  });

  it("only ever gets louder, never quieter", () => {
    const order = ["none", "gentle", "firm", "urgent", "final"];
    let previous = 0;
    for (let hour = 9; hour < 24; hour += 1) {
      const rank = order.indexOf(nagLevel(false, atSgHour(hour)));
      expect(rank).toBeGreaterThanOrEqual(previous);
      previous = rank;
    }
  });
});

describe("what the nag says", () => {
  it("says nothing when there is nothing to say", () => {
    expect(nagCopy("none")).toBeNull();
  });

  it("uses the person's first name when there is one", () => {
    expect(nagCopy("gentle", "Ahmad")?.title).toContain("Ahmad");
  });

  it("reads properly without a name", () => {
    const copy = nagCopy("gentle");
    expect(copy?.title).not.toContain("undefined");
    expect(copy?.title).not.toMatch(/,\s*$/);
  });

  it("only demands attention at the last two levels", () => {
    expect(nagCopy("gentle")?.insistent).toBe(false);
    expect(nagCopy("firm")?.insistent).toBe(false);
    expect(nagCopy("urgent")?.insistent).toBe(true);
    expect(nagCopy("final")?.insistent).toBe(true);
  });

  it("mentions the deadline once it actually matters", () => {
    expect(nagCopy("urgent")?.body).toMatch(/11:59/);
    expect(nagCopy("final")?.body ?? "").toMatch(/missed|now/i);
  });
});

describe("time remaining", () => {
  it("counts down to 23:59 Singapore", () => {
    expect(minutesToDeadline(atSgHour(23, 0))).toBe(59);
    expect(minutesToDeadline(atSgHour(22, 59))).toBe(60);
    expect(minutesToDeadline(atSgHour(12, 0))).toBe(11 * 60 + 59);
  });

  it("resets at Singapore midnight rather than going negative", () => {
    // 16:00 UTC is midnight in Singapore, so the deadline that just passed is
    // replaced by tonight's - nearly a full day out. There is no moment where
    // today is closed but still today.
    expect(minutesToDeadline(new Date("2026-03-10T15:59:00Z"))).toBe(0);
    expect(minutesToDeadline(new Date("2026-03-10T16:00:00Z"))).toBe(
      23 * 60 + 59,
    );
  });

  it("reads naturally", () => {
    expect(timeLeftLabel(atSgHour(20))).toMatch(/3 hours left/);
    expect(timeLeftLabel(atSgHour(23, 30))).toMatch(/29 minutes left/);
    expect(timeLeftLabel(atSgHour(23, 59))).toMatch(/0 minutes left/);
  });

  it("uses the singular for one", () => {
    expect(timeLeftLabel(atSgHour(23, 58))).toBe("1 minute left");
  });
});
