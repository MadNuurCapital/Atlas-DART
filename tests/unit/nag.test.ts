import { describe, it, expect } from "vitest";
import {
  nagLevel,
  nagCopy,
  sgHour,
  nagBusinessDate,
  isOverdue,
  minutesToDeadline,
  timeLeftLabel,
  NAG_START_HOUR,
  NAG_END_HOUR,
} from "@/lib/nag";

/**
 * An instant, given as a Singapore wall-clock hour on 10 March 2026.
 * Singapore is UTC+8, so hours 0-7 fall on the previous UTC day.
 */
function atSgHour(hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 2, 10, hour - 8, minute));
}

describe("Singapore hour", () => {
  it("reads the Singapore clock, not the runtime's", () => {
    expect(sgHour(new Date("2026-03-10T11:00:00Z"))).toBe(19);
    expect(sgHour(new Date("2026-03-10T15:00:00Z"))).toBe(23);
    expect(sgHour(new Date("2026-03-10T16:00:00Z"))).toBe(0);
    expect(sgHour(new Date("2026-03-10T22:00:00Z"))).toBe(6);
  });
});

describe("when the chase runs", () => {
  it("never chases someone who has already submitted", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      expect(nagLevel(true, atSgHour(hour))).toBe("none");
    }
  });

  it("says nothing between 7am and 7pm", () => {
    // Chasing people mid-afternoon is how they learn to ignore it.
    for (let hour = NAG_END_HOUR; hour < NAG_START_HOUR; hour += 1) {
      expect(nagLevel(false, atSgHour(hour)), `hour ${hour}`).toBe("none");
    }
  });

  it("escalates through the evening", () => {
    expect(nagLevel(false, atSgHour(19))).toBe("firm");
    expect(nagLevel(false, atSgHour(20))).toBe("firm");
    expect(nagLevel(false, atSgHour(21))).toBe("urgent");
    expect(nagLevel(false, atSgHour(22))).toBe("urgent");
    expect(nagLevel(false, atSgHour(23))).toBe("final");
  });

  it("switches to overdue after midnight, through to 6am", () => {
    for (let hour = 0; hour < NAG_END_HOUR; hour += 1) {
      expect(nagLevel(false, atSgHour(hour)), `hour ${hour}`).toBe("overdue");
    }
  });

  it("goes quiet again at 7am, once the admin list has gone out", () => {
    expect(nagLevel(false, atSgHour(7))).toBe("none");
  });
});

describe("which day is being chased", () => {
  it("chases today during the evening", () => {
    expect(nagBusinessDate(atSgHour(19))).toBe("2026-03-10");
    expect(nagBusinessDate(atSgHour(23))).toBe("2026-03-10");
  });

  it("chases yesterday overnight", () => {
    // At 2am nobody owes anything for the day that just started.
    expect(nagBusinessDate(atSgHour(0))).toBe("2026-03-09");
    expect(nagBusinessDate(atSgHour(3))).toBe("2026-03-09");
    expect(nagBusinessDate(atSgHour(6))).toBe("2026-03-09");
  });

  it("moves back to today from 7am", () => {
    expect(nagBusinessDate(atSgHour(7))).toBe("2026-03-10");
  });

  it("knows when the deadline has passed", () => {
    expect(isOverdue(atSgHour(23))).toBe(false);
    expect(isOverdue(atSgHour(0))).toBe(true);
    expect(isOverdue(atSgHour(6))).toBe(true);
    expect(isOverdue(atSgHour(7))).toBe(false);
  });
});

describe("what the notification says", () => {
  it("says nothing when there is nothing to say", () => {
    expect(nagCopy("none")).toBeNull();
  });

  it("uses the wording asked for", () => {
    expect(nagCopy("firm", "Ahmad")?.title).toContain("DART is not updated");
  });

  it("uses the person's first name when there is one", () => {
    expect(nagCopy("firm", "Ahmad")?.title).toContain("Ahmad");
  });

  it("reads properly without a name", () => {
    const copy = nagCopy("firm");
    expect(copy?.title).not.toContain("undefined");
    expect(copy?.title).not.toMatch(/,\s*$/);
  });

  it("is silent overnight and audible before midnight", () => {
    // The whole reason the overnight chase is acceptable.
    expect(nagCopy("firm")?.silent).toBe(false);
    expect(nagCopy("urgent")?.silent).toBe(false);
    expect(nagCopy("final")?.silent).toBe(false);
    expect(nagCopy("overdue")?.silent).toBe(true);
  });

  it("says yesterday overnight, not today", () => {
    expect(nagCopy("overdue")?.title).toMatch(/yesterday/i);
    expect(nagCopy("firm")?.title).not.toMatch(/yesterday/i);
  });

  it("mentions the 6am list once it is the only lever left", () => {
    expect(nagCopy("overdue")?.body).toMatch(/6 AM/i);
  });

  it("demands attention from 9pm onwards", () => {
    expect(nagCopy("firm")?.insistent).toBe(false);
    expect(nagCopy("urgent")?.insistent).toBe(true);
    expect(nagCopy("final")?.insistent).toBe(true);
    expect(nagCopy("overdue")?.insistent).toBe(true);
  });
});

describe("time remaining", () => {
  it("counts down to 23:59 Singapore", () => {
    expect(minutesToDeadline(atSgHour(23, 0))).toBe(59);
    expect(minutesToDeadline(atSgHour(22, 59))).toBe(60);
    expect(minutesToDeadline(atSgHour(19, 0))).toBe(4 * 60 + 59);
  });

  it("reads naturally before the deadline", () => {
    expect(timeLeftLabel(atSgHour(20))).toBe("3 hours left");
    expect(timeLeftLabel(atSgHour(23, 30))).toBe("29 minutes left");
    expect(timeLeftLabel(atSgHour(23, 58))).toBe("1 minute left");
  });

  it("says the deadline has passed once it has", () => {
    expect(timeLeftLabel(atSgHour(1))).toBe("Deadline passed");
    expect(timeLeftLabel(atSgHour(6))).toBe("Deadline passed");
  });
});
