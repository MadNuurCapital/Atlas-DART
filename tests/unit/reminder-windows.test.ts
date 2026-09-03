import { describe, it, expect } from "vitest";
import {
  sgHour,
  withinHourWindow,
} from "../../netlify/functions/lib/reminders.mts";

/**
 * A reminder must arrive in the hour it was meant for, or not at all.
 *
 * Every reminder function decides what to send by reading the clock when it
 * runs. That is correct when it runs on time. GitHub's scheduler is only
 * best-effort, though: runs arrive late, sometimes by hours, and a late run
 * used to send anyway, at whatever hour it happened to wake up.
 *
 * That is what the team reported as "notifications at different timings".
 */

const CHASE = { from: 19, to: 6 };
const MORNING = { from: 6, to: 11 };
const EVENING = { from: 17, to: 22 };
const DIGEST = { from: 5, to: 13 };

const inChase = (h: number) => withinHourWindow(h, CHASE.from, CHASE.to);

describe("a window that wraps around midnight", () => {
  it("covers the evening, midnight and the early hours", () => {
    for (const hour of [19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6]) {
      expect(inChase(hour), `${hour}:00 must be inside the chase`).toBe(true);
    }
  });

  it("excludes the whole working day", () => {
    for (const hour of [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]) {
      expect(inChase(hour), `${hour}:00 must be outside the chase`).toBe(false);
    }
  });

  it("is inclusive at both ends, and excludes the hours either side", () => {
    expect(inChase(18)).toBe(false);
    expect(inChase(19)).toBe(true);
    expect(inChase(6)).toBe(true);
    expect(inChase(7)).toBe(false);
  });

  /**
   * The regression. The chase's own `levelForHour` maps every hour from 7am to
   * 8pm to "firm", so before this window existed a run that slipped to
   * lunchtime told the entire team their DART was not updated - at lunchtime,
   * with sound, about a day that had barely started.
   */
  it("shuts out the lunchtime chase that started all this", () => {
    expect(inChase(11)).toBe(false);
    expect(inChase(12)).toBe(false);
    expect(inChase(13)).toBe(false);
  });
});

describe("an ordinary window", () => {
  it("includes both ends and nothing beyond them", () => {
    expect(withinHourWindow(5, DIGEST.from, DIGEST.to)).toBe(true);
    expect(withinHourWindow(13, DIGEST.from, DIGEST.to)).toBe(true);
    expect(withinHourWindow(4, DIGEST.from, DIGEST.to)).toBe(false);
    expect(withinHourWindow(14, DIGEST.from, DIGEST.to)).toBe(false);
  });

  it("keeps the 6 AM digest out of the evening", () => {
    expect(withinHourWindow(20, DIGEST.from, DIGEST.to)).toBe(false);
  });
});

describe("the two coaching slots stay apart", () => {
  // Mirrors kindForHour in coaching-reminders.mts.
  const kindFor = (hour: number) =>
    withinHourWindow(hour, MORNING.from, MORNING.to)
      ? "morning_of"
      : withinHourWindow(hour, EVENING.from, EVENING.to)
        ? "day_before"
        : null;

  it("reads the morning slot as the morning of", () => {
    expect(kindFor(8)).toBe("morning_of");
  });

  it("reads the evening slot as the day before", () => {
    expect(kindFor(19)).toBe("day_before");
  });

  it("never lets one slot become the other", () => {
    // The real failure: the 08:00 run arrived at 17:47 and, because the kind
    // was chosen by asking only whether the hour was before midday, sent the
    // evening-before reminder for the NEXT day. It went unnoticed only because
    // no session happened to be booked.
    expect(kindFor(17)).not.toBe("morning_of");
    expect(kindFor(8)).not.toBe("day_before");
  });

  it("sends nothing in the hours between the slots", () => {
    for (const hour of [12, 13, 14, 15, 16]) {
      expect(kindFor(hour), `${hour}:00 belongs to neither slot`).toBeNull();
    }
  });

  it("sends nothing overnight", () => {
    for (const hour of [23, 0, 3, 5]) {
      expect(kindFor(hour), `${hour}:00 belongs to neither slot`).toBeNull();
    }
  });
});

describe("the Singapore hour is read from Singapore", () => {
  it("does not inherit the runtime timezone", () => {
    // 11:00 UTC is 19:00 Singapore - the first chase of the night.
    expect(sgHour(new Date("2026-09-01T11:00:00Z"))).toBe(19);
  });

  it("reads a delayed run as the hour it actually woke up in", () => {
    // 03:46 UTC is 11:46 Singapore. A real run landed here, and this is the
    // hour the window has to reject.
    expect(sgHour(new Date("2026-09-01T03:46:00Z"))).toBe(11);
    expect(inChase(sgHour(new Date("2026-09-01T03:46:00Z")))).toBe(false);
  });

  it("handles the Singapore midnight rollover", () => {
    expect(sgHour(new Date("2026-09-01T15:59:00Z"))).toBe(23);
    expect(sgHour(new Date("2026-09-01T16:00:00Z"))).toBe(0);
  });
});
