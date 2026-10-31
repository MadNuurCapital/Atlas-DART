import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEADLINE_HOUR,
  DEADLINE_SLOT,
  copyFor,
  levelFor,
  reminderTypeFor,
} from "../../netlify/functions/push-reminders.mts";
import { sgHour, withinHourWindow } from "../../netlify/functions/lib/reminders.mts";

/**
 * The evening chase is five slots a night, and each has to be its own reminder.
 *
 * It used to be twelve - hourly from 7 PM to 6 AM - which is how someone who
 * forgot got seven notifications between midnight and dawn. Cutting it to five
 * introduced a problem the hourly version could not have: two slots in the same
 * hour.
 *
 * 11 PM and 11:59 PM are both hour 23, and reminder_logs is keyed by the hour.
 * Without a name of its own the final call keys on push_23, finds the 11 PM row
 * already written, and skips itself as a duplicate of the thing it is meant to
 * follow. It would have sent nothing, logged nothing, and reported success.
 */

/** The five slots, as UTC crons, exactly as the schedule declares them. */
const SLOTS = [
  { cron: "0 11 * * *", utc: "11:00", hour: 19, slot: null, level: "firm" },
  { cron: "0 13 * * *", utc: "13:00", hour: 21, slot: null, level: "urgent" },
  { cron: "0 15 * * *", utc: "15:00", hour: 23, slot: null, level: "final" },
  {
    cron: "59 15 * * *",
    utc: "15:59",
    hour: 23,
    slot: DEADLINE_SLOT,
    level: "deadline",
  },
  { cron: "0 22 * * *", utc: "22:00", hour: 6, slot: null, level: "overdue" },
] as const;

describe("every slot is a distinct reminder", () => {
  it("gives each of the five its own log key", () => {
    const keys = SLOTS.map((s) => reminderTypeFor(s.hour, s.slot));
    expect(new Set(keys).size).toBe(SLOTS.length);
    expect(keys).toEqual([
      "push_19",
      "push_21",
      "push_23",
      "push_deadline",
      "push_6",
    ]);
  });

  /**
   * The regression, stated as the collision itself rather than as a list of
   * expected strings: if the slot ever stops taking precedence over the hour,
   * these two become one reminder and the final call is lost.
   */
  it("does not let the final call collide with 11 PM", () => {
    expect(reminderTypeFor(DEADLINE_HOUR, DEADLINE_SLOT)).not.toBe(
      reminderTypeFor(DEADLINE_HOUR, null),
    );
  });

  it("reads each slot at the level it was meant to send", () => {
    for (const s of SLOTS) {
      expect(levelFor(s.hour, s.slot), `${s.utc} UTC`).toBe(s.level);
    }
  });

  it("keeps all five inside the hours the team agreed to", () => {
    for (const s of SLOTS) {
      expect(withinHourWindow(s.hour, 19, 6), `${s.hour}:00 SGT`).toBe(true);
    }
  });

  it("derives the Singapore hour each cron actually lands in", () => {
    for (const s of SLOTS) {
      const [h, m] = s.utc.split(":");
      expect(sgHour(new Date(`2026-09-01T${h}:${m}:00Z`)), s.cron).toBe(s.hour);
    }
  });
});

describe("the four audible slots say four different things", () => {
  it("never repeats a title, so the chase escalates instead of nagging", () => {
    const titles = SLOTS.map((s) => copyFor(levelFor(s.hour, s.slot), "Faisal").title);
    expect(new Set(titles).size).toBe(SLOTS.length);
  });

  it("keeps only the 6 AM one silent", () => {
    for (const s of SLOTS) {
      const { silent } = copyFor(levelFor(s.hour, s.slot), "Faisal");
      expect(silent, `${s.hour}:00 SGT`).toBe(s.level === "overdue");
    }
  });

  it("names the person, because a notification addressed to nobody is ignored", () => {
    expect(copyFor("deadline", "Faisal").title).toContain("Faisal");
  });
});

describe("the schedule on disk matches the function", () => {
  const workflow = readFileSync(
    join(import.meta.dirname, "../../.github/workflows/reminders.yml"),
    "utf8",
  );

  it.each(SLOTS)("declares $cron", ({ cron }) => {
    expect(workflow).toContain(`- cron: "${cron}"`);
  });

  it("no longer declares the hourly chase", () => {
    expect(workflow).not.toContain("0 11-22 * * *");
  });

  it("passes slot=deadline, and only for the 23:59 cron", () => {
    // The mapping is a shell case statement, so this checks the one line that
    // sets it rather than trying to parse the script.
    expect(workflow).toMatch(
      /"59 15 \* \* \*"\)\s*targets="push-reminders";\s*extra="slot=deadline"/,
    );
    expect(workflow.match(/extra="slot=deadline"/g)).toHaveLength(1);
  });

  it("mirrors the same five slots in pg_cron", () => {
    const sql = readFileSync(
      join(import.meta.dirname, "../../supabase/retune-reminder-schedule.sql"),
      "utf8",
    );

    for (const { cron } of SLOTS) {
      expect(sql, cron).toContain(`'${cron}'`);
    }

    // The step that actually quietens the night. The five new jobs have new
    // names, so without this the hourly job keeps running beside them.
    expect(sql).toContain("cron.unschedule('atlas-dart-push-reminders')");
  });
});
