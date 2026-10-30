import { describe, it, expect } from "vitest";
import {
  withRollback,
  actAs,
  seedUser,
  seedSubmission,
  sgToday,
} from "./helpers.ts";

/**
 * Streaks are derived from daily_submissions every time, never stored.
 *
 * A stored counter drifts the moment anything unusual happens - a submission
 * edited after the fact, a day backfilled by an admin - and a streak that says
 * 14 when the days say 9 is worse than no streak at all, because nobody can
 * tell which number to believe.
 *
 * These tests are mostly about the edges, because that is where a streak is
 * easy to get subtly wrong: what today does to it, what a gap does to it, and
 * what a draft does to it.
 */

/** Yesterday, the day before, and so on, as Singapore business dates. */
function daysBefore(today: string, n: number): string {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - n, 12)).toISOString().slice(0, 10);
}

async function streaks(
  client: Parameters<typeof actAs>[0],
): Promise<{
  current: number;
  longest: number;
  submitted_today: boolean;
  total_days: number;
}> {
  const { rows } = await client.query("select public.my_streaks() as s");
  return rows[0].s;
}

describe("the current streak", () => {
  it("counts consecutive submitted days ending today", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      const today = await sgToday(client);

      for (const n of [0, 1, 2]) {
        await seedSubmission(client, user.id, daysBefore(today, n));
      }

      await actAs(client, user.id);
      const s = await streaks(client);

      expect(s.current).toBe(3);
      expect(s.submitted_today).toBe(true);
    });
  });

  /**
   * The one most likely to be got wrong. At ten in the morning nobody has
   * submitted today, and a counter reading 0 until the evening would be wrong
   * every single morning.
   */
  it("survives today being unsubmitted, because the day is not over", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      const today = await sgToday(client);

      for (const n of [1, 2, 3]) {
        await seedSubmission(client, user.id, daysBefore(today, n));
      }

      await actAs(client, user.id);
      const s = await streaks(client);

      expect(s.current).toBe(3);
      expect(s.submitted_today).toBe(false);
    });
  });

  it("is broken by a missed day once that day has closed", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      const today = await sgToday(client);

      // Nothing yesterday or the day before: the run ended two days ago and
      // is finished, not merely waiting.
      for (const n of [2, 3, 4]) {
        await seedSubmission(client, user.id, daysBefore(today, n));
      }

      await actAs(client, user.id);
      const s = await streaks(client);

      expect(s.current).toBe(0);
      // The history is not erased by the break.
      expect(s.longest).toBe(3);
    });
  });

  it("counts a late submission, because a late one still beats a missing one", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      const today = await sgToday(client);

      await seedSubmission(client, user.id, daysBefore(today, 0));
      await seedSubmission(client, user.id, daysBefore(today, 1));

      // first_submitted_at is trigger-owned, so lateness cannot be forged
      // here; what matters is that the streak does not consult it. Requiring
      // on-time would tell somebody who remembered at 12:30am that their
      // submission no longer counts, which is the opposite of what we want.
      await actAs(client, user.id);
      expect((await streaks(client)).current).toBe(2);
    });
  });

  it("does not count a draft", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      const today = await sgToday(client);

      await seedSubmission(client, user.id, daysBefore(today, 1));
      await seedSubmission(client, user.id, daysBefore(today, 2), {
        status: "draft",
      });
      await seedSubmission(client, user.id, daysBefore(today, 3));

      await actAs(client, user.id);
      const s = await streaks(client);

      // A half-filled form is not a submission, here as everywhere else.
      expect(s.current).toBe(1);
      expect(s.total_days).toBe(2);
    });
  });
});

describe("the longest streak", () => {
  it("remembers the best run even after it is broken", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      const today = await sgToday(client);

      // A run of 4, a gap, then a run of 2 up to yesterday.
      for (const n of [10, 9, 8, 7]) {
        await seedSubmission(client, user.id, daysBefore(today, n));
      }
      for (const n of [2, 1]) {
        await seedSubmission(client, user.id, daysBefore(today, n));
      }

      await actAs(client, user.id);
      const s = await streaks(client);

      expect(s.current).toBe(2);
      expect(s.longest).toBe(4);
      expect(s.total_days).toBe(6);
    });
  });

  it("equals the current streak when the best run is the live one", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      const today = await sgToday(client);

      for (const n of [0, 1, 2, 3, 4]) {
        await seedSubmission(client, user.id, daysBefore(today, n));
      }

      await actAs(client, user.id);
      const s = await streaks(client);
      expect(s.current).toBe(5);
      expect(s.longest).toBe(5);
    });
  });
});

describe("a streak belongs to one person", () => {
  it("returns zeroes for somebody who has never submitted", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      await actAs(client, user.id);
      const s = await streaks(client);

      // Somebody's first day must not be an error or a null.
      expect(s).toEqual({
        current: 0,
        longest: 0,
        submitted_today: false,
        total_days: 0,
      });
    });
  });

  it("never counts a colleague's days", async () => {
    await withRollback(async (client) => {
      const mine = await seedUser(client);
      const theirs = await seedUser(client);
      const today = await sgToday(client);

      for (const n of [0, 1, 2, 3, 4, 5]) {
        await seedSubmission(client, theirs.id, daysBefore(today, n));
      }
      await seedSubmission(client, mine.id, daysBefore(today, 0));

      await actAs(client, mine.id);
      const s = await streaks(client);

      expect(s.current).toBe(1);
      expect(s.longest).toBe(1);
    });
  });

  it("is SECURITY INVOKER", async () => {
    await withRollback(async (client) => {
      const { rows } = await client.query(
        "select prosecdef from pg_proc where proname = 'my_streaks'",
      );
      expect(rows[0].prosecdef).toBe(false);
    });
  });
});

describe("the dashboard carries the streak without a second round trip", () => {
  it("includes it in dashboard_payload, alongside the existing keys", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      const today = await sgToday(client);
      await seedSubmission(client, user.id, daysBefore(today, 0));
      await seedSubmission(client, user.id, daysBefore(today, 1));

      await actAs(client, user.id);
      const { rows } = await client.query(
        "select public.dashboard_payload($1,$2,$3,$4) as p",
        [daysBefore(today, 30), today, 2026, 10],
      );

      expect(rows[0].p.streaks.current).toBe(2);

      // The keys the page already relied on must all still be there - adding a
      // feature must not quietly reshape the payload.
      expect(Object.keys(rows[0].p).sort()).toEqual([
        "coaching",
        "days",
        "mix",
        "pending",
        "streaks",
        "target",
      ]);
    });
  });
});
