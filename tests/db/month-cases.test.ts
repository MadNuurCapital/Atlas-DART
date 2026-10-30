import { describe, it, expect } from "vitest";
import {
  withRollback,
  actAs,
  asOwner,
  seedUser,
  seedSubmission,
  seedInsurer,
  seedCase,
  sgToday,
} from "./helpers.ts";

/**
 * Cases this month, measured against your own best start.
 *
 * The comparison is the whole feature. Counting cases is easy; counting them
 * in a way that is fair on the 3rd of the month is the part worth testing.
 */

/**
 * A fixed "today", the 12th of a month, passed to the function explicitly.
 *
 * Without pinning, these tests depend on whatever day they happen to run. The
 * first attempt did, and two of them passed for the wrong reason while a third
 * failed on a date bug of my own: asking for "the same day number, one month
 * back" from the 31st of October produced the 1st of OCTOBER, because
 * September has thirty days. Every case then landed in the current month.
 *
 * Worse, the central behaviour - an earlier month being ahead at this point but
 * behind overall - is impossible to construct on the 31st, because no earlier
 * month has a later day to be ahead on.
 */
const AS_OF = "2026-06-12";
const THIS_MONTH = "2026-06";
const LAST_MONTH = "2026-05";

async function monthCases(client: Parameters<typeof actAs>[0]) {
  const { rows } = await client.query(
    "select public.my_month_cases($1) as c",
    [AS_OF],
  );
  return rows[0].c as {
    this_month: number;
    best_start: number;
    best_total: number;
    last_month: number;
    is_best_start: boolean;
    month_label: string;
  };
}

describe("cases this month", () => {
  it("counts active cases submitted in the current month", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      const insurer = await seedInsurer(client);

      for (const day of ["01", "05", "12"]) {
        await seedCase(client, user.id, insurer, {
          dateSubmitted: `${THIS_MONTH}-${day}`,
        });
      }

      await actAs(client, user.id);
      expect((await monthCases(client)).this_month).toBe(3);
    });
  });

  it("drops a cancelled case from the count", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      const insurer = await seedInsurer(client);

      await seedCase(client, user.id, insurer, {
        dateSubmitted: `${THIS_MONTH}-05`,
      });
      const doomed = await seedCase(client, user.id, insurer, {
        dateSubmitted: `${THIS_MONTH}-06`,
      });

      // Cancelled properly: the cases_cancellation_complete constraint demands
      // a reason and a timestamp, so a status change alone is rejected - which
      // is the schema refusing to record a cancellation nobody explained.
      await asOwner(client);
      await client.query(
        `update public.cases
            set status = 'cancelled',
                cancellation_reason = 'Client changed their mind',
                cancelled_at = now()
          where id = $1`,
        [doomed],
      );

      await actAs(client, user.id);
      // A record built on a case that was cancelled was never a record.
      expect((await monthCases(client)).this_month).toBe(1);
    });
  });

  it("ignores a colleague's cases entirely", async () => {
    await withRollback(async (client) => {
      const mine = await seedUser(client);
      const theirs = await seedUser(client);
      const insurer = await seedInsurer(client);

      await seedCase(client, mine.id, insurer, {
        dateSubmitted: `${THIS_MONTH}-05`,
      });
      for (let i = 0; i < 9; i += 1) {
        await seedCase(client, theirs.id, insurer, {
          dateSubmitted: `${THIS_MONTH}-05`,
        });
      }

      await actAs(client, mine.id);
      const c = await monthCases(client);
      expect(c.this_month).toBe(1);
      expect(c.best_start).toBe(0);
    });
  });
});

describe("the comparison is made at the same point in the month", () => {
  /**
   * The test this whole design exists for.
   *
   * May finished on 9 cases but had only 1 by the 12th. Two cases in by the
   * 12th of June is therefore the best START, even though June is nowhere near
   * 9 yet. Comparing against the finished total would have called it a
   * failure, on a month that is going perfectly well.
   */
  it("beats a month that finished far higher but started slower", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      const insurer = await seedInsurer(client);

      await seedCase(client, user.id, insurer, {
        dateSubmitted: `${LAST_MONTH}-03`,
      });
      for (let i = 0; i < 8; i += 1) {
        await seedCase(client, user.id, insurer, {
          dateSubmitted: `${LAST_MONTH}-25`,
        });
      }

      await seedCase(client, user.id, insurer, {
        dateSubmitted: `${THIS_MONTH}-04`,
      });
      await seedCase(client, user.id, insurer, {
        dateSubmitted: `${THIS_MONTH}-11`,
      });

      await actAs(client, user.id);
      const c = await monthCases(client);

      expect(c.this_month).toBe(2);
      expect(c.best_start).toBe(1);
      expect(c.best_total).toBe(9);
      expect(c.last_month).toBe(9);
      // Behind on the month, ahead on the start. Ahead is the honest reading.
      expect(c.is_best_start).toBe(true);
    });
  });

  it("does not claim a best start when the earlier month was ahead", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      const insurer = await seedInsurer(client);

      for (const day of ["02", "04", "07", "09"]) {
        await seedCase(client, user.id, insurer, {
          dateSubmitted: `${LAST_MONTH}-${day}`,
        });
      }
      await seedCase(client, user.id, insurer, {
        dateSubmitted: `${THIS_MONTH}-03`,
      });

      await actAs(client, user.id);
      const c = await monthCases(client);
      expect(c.best_start).toBe(4);
      expect(c.is_best_start).toBe(false);
    });
  });

  it("ignores an earlier month's cases that fall after this day number", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      const insurer = await seedInsurer(client);

      // All on the 20th: after the 12th, so none of them count as a "start".
      for (let i = 0; i < 6; i += 1) {
        await seedCase(client, user.id, insurer, {
          dateSubmitted: `${LAST_MONTH}-20`,
        });
      }
      await seedCase(client, user.id, insurer, {
        dateSubmitted: `${THIS_MONTH}-02`,
      });

      await actAs(client, user.id);
      const c = await monthCases(client);
      expect(c.best_start).toBe(0);
      expect(c.best_total).toBe(6);
      expect(c.is_best_start).toBe(true);
    });
  });

  it("never calls zero a personal best", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      await actAs(client, user.id);
      const c = await monthCases(client);

      // "0 cases, your best start yet" would be absurd in somebody's first
      // month and insulting in any other.
      expect(c.this_month).toBe(0);
      expect(c.is_best_start).toBe(false);
    });
  });

  it("gives a first-ever case the best start, since there is nothing above it", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      const insurer = await seedInsurer(client);
      await seedCase(client, user.id, insurer, {
        dateSubmitted: `${THIS_MONTH}-05`,
      });

      await actAs(client, user.id);
      const c = await monthCases(client);
      expect(c.this_month).toBe(1);
      expect(c.is_best_start).toBe(true);
    });
  });

  it("does not count the current month as its own record to beat", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      const insurer = await seedInsurer(client);

      for (let i = 0; i < 5; i += 1) {
        await seedCase(client, user.id, insurer, {
          dateSubmitted: `${THIS_MONTH}-01`,
        });
      }

      await actAs(client, user.id);
      const c = await monthCases(client);

      // best_start looks only at months BEFORE this one. Including this one
      // would make every month tie with itself and nobody would ever win.
      expect(c.this_month).toBe(5);
      expect(c.best_start).toBe(0);
      expect(c.is_best_start).toBe(true);
    });
  });
});

describe("days without a submission", () => {
  async function missed(client: Parameters<typeof actAs>[0]) {
    const { rows } = await client.query(
      "select public.my_missed_days($1) as m",
      [AS_OF],
    );
    return rows[0].m as {
      ever_submitted: boolean;
      missed: number;
      submitted_today: boolean;
    };
  }

  /** N days before the pinned date. Safe: the 12th minus 11 is still June. */
  function daysBefore(n: number): string {
    const [y, m, d] = AS_OF.split("-").map(Number) as [number, number, number];
    return new Date(Date.UTC(y, m - 1, d - n, 12)).toISOString().slice(0, 10);
  }

  it("is zero when yesterday was submitted", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      await seedSubmission(client, user.id, daysBefore(1));

      await actAs(client, user.id);
      const m = await missed(client);
      expect(m.missed).toBe(0);
      expect(m.submitted_today).toBe(false);
    });
  });

  it("does not count today against anybody until it closes", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      await seedSubmission(client, user.id, daysBefore(1));

      await actAs(client, user.id);
      // At ten in the morning, counting today would tell everybody they had
      // missed a day, every morning.
      expect((await missed(client)).missed).toBe(0);
    });
  });

  it("counts the closed days since the last submission", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      await seedSubmission(client, user.id, daysBefore(4));

      await actAs(client, user.id);
      // Days 3, 2 and 1 are closed and missed. Today is not counted.
      expect((await missed(client)).missed).toBe(3);
    });
  });

  it("distinguishes never-submitted from lapsed", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      await actAs(client, user.id);
      const m = await missed(client);

      // Somebody's first day should not read as a lapse.
      expect(m.ever_submitted).toBe(false);
      expect(m.missed).toBe(0);
    });
  });

  it("resets once they submit again", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      await seedSubmission(client, user.id, daysBefore(5));
      await seedSubmission(client, user.id, AS_OF);

      await actAs(client, user.id);
      const m = await missed(client);
      expect(m.missed).toBe(0);
      expect(m.submitted_today).toBe(true);
    });
  });
});

describe("the dashboard payload carries both, in one round trip", () => {
  it("replaces streaks with cases_month and missed", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      await actAs(client, user.id);
      const today = await sgToday(client);

      const { rows } = await client.query(
        "select public.dashboard_payload($1,$2,$3,$4) as p",
        [`${today.slice(0, 7)}-01`, today, 2026, 10],
      );

      expect(Object.keys(rows[0].p).sort()).toEqual([
        "cases_month",
        "coaching",
        "days",
        "missed",
        "mix",
        "pending",
        "target",
      ]);
    });
  });

  it("has retired the streak function rather than leaving it behind", async () => {
    await withRollback(async (client) => {
      const { rows } = await client.query(
        "select count(*)::int as n from pg_proc where proname = 'my_streaks'",
      );
      // An unused function that still compiles is the kind of thing somebody
      // wires back up in a year without knowing it was deliberately retired.
      expect(rows[0].n).toBe(0);
    });
  });
});
