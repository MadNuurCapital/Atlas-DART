import { describe, it, expect, afterAll } from "vitest";
import {
  pool,
  withRollback,
  actAs,
  asOwner,
  seedUser,
  sgToday,
  expectRejection,
} from "./helpers";

afterAll(async () => {
  await pool.end();
});

type Submission = {
  id: string;
  first_submitted_at: Date | null;
  last_submitted_at: Date | null;
  revision_count: number;
  status: string;
};

async function insertToday(
  c: Parameters<Parameters<typeof withRollback>[0]>[0],
  userId: string,
  status: "draft" | "submitted",
  dials = 10,
): Promise<Submission> {
  const { rows } = await c.query<Submission>(
    `insert into public.daily_submissions
       (user_id, business_date, dials, talked_to, campaign_status, in_office, status)
     values ($1, public.sg_today(), $2, 5, 'running', true, $3)
     returning id, first_submitted_at, last_submitted_at, revision_count, status`,
    [userId, dials, status],
  );
  return rows[0]!;
}

async function reload(
  c: Parameters<Parameters<typeof withRollback>[0]>[0],
  id: string,
): Promise<Submission> {
  const { rows } = await c.query<Submission>(
    `select id, first_submitted_at, last_submitted_at, revision_count, status
       from public.daily_submissions where id = $1`,
    [id],
  );
  return rows[0]!;
}

describe("one submission per person per date", () => {
  it("rejects a duplicate for the same date", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await actAs(c, a.id);
      await insertToday(c, a.id, "submitted");

      const err = await expectRejection(() =>
        insertToday(c, a.id, "submitted"),
      );
      expect(err.message).toMatch(/duplicate key|unique/i);
    });
  });

  it("allows the same date for two different people", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const b = await seedUser(c);

      await actAs(c, a.id);
      await insertToday(c, a.id, "submitted");
      await actAs(c, b.id);
      await insertToday(c, b.id, "submitted");

      await asOwner(c);
      const { rows } = await c.query("select * from public.daily_submissions");
      expect(rows).toHaveLength(2);
    });
  });
});

describe("submission timing is owned by the database", () => {
  it("leaves a draft with no timestamps", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await actAs(c, a.id);
      const row = await insertToday(c, a.id, "draft");

      expect(row.first_submitted_at).toBeNull();
      expect(row.last_submitted_at).toBeNull();
      expect(row.revision_count).toBe(0);
    });
  });

  it("stamps both timestamps on first submission, with no revision", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await actAs(c, a.id);
      const row = await insertToday(c, a.id, "submitted");

      expect(row.first_submitted_at).not.toBeNull();
      expect(row.last_submitted_at).not.toBeNull();
      expect(row.revision_count).toBe(0);
    });
  });

  it("does not count draft -> submitted as a revision", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await actAs(c, a.id);
      const draft = await insertToday(c, a.id, "draft");

      await c.query(
        "update public.daily_submissions set status = 'submitted' where id = $1",
        [draft.id],
      );
      const after = await reload(c, draft.id);

      expect(after.revision_count).toBe(0);
      expect(after.first_submitted_at).not.toBeNull();
    });
  });

  it("preserves first_submitted_at across a resubmission", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await actAs(c, a.id);
      const row = await insertToday(c, a.id, "submitted", 10);
      const originalFirst = (await reload(c, row.id)).first_submitted_at;

      await c.query(
        "update public.daily_submissions set dials = 22 where id = $1",
        [row.id],
      );
      const after = await reload(c, row.id);

      expect(after.first_submitted_at?.getTime()).toBe(
        originalFirst?.getTime(),
      );
      expect(after.revision_count).toBe(1);
    });
  });

  it("ignores a client trying to rewrite first_submitted_at", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await actAs(c, a.id);
      const row = await insertToday(c, a.id, "submitted");
      const originalFirst = (await reload(c, row.id)).first_submitted_at;

      // A client backdating itself to look on time for a deadline it missed.
      await c.query(
        `update public.daily_submissions
            set first_submitted_at = timestamptz '2020-01-01 00:00:00+08',
                revision_count = 0
          where id = $1`,
        [row.id],
      );
      const after = await reload(c, row.id);

      expect(after.first_submitted_at?.getTime()).toBe(
        originalFirst?.getTime(),
      );
    });
  });

  it("does not treat an identical resubmit as a revision (double click)", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await actAs(c, a.id);
      const row = await insertToday(c, a.id, "submitted", 10);
      const first = await reload(c, row.id);

      // Exactly what a double-click or a retried request looks like: the same
      // payload written twice.
      for (let i = 0; i < 3; i++) {
        await c.query(
          `update public.daily_submissions
              set dials = 10, talked_to = 5, campaign_status = 'running',
                  in_office = true, status = 'submitted'
            where id = $1`,
          [row.id],
        );
      }
      const after = await reload(c, row.id);

      expect(after.revision_count).toBe(0);
      expect(after.last_submitted_at?.getTime()).toBe(
        first.last_submitted_at?.getTime(),
      );
    });
  });

  it("counts each material change as one revision", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await actAs(c, a.id);
      const row = await insertToday(c, a.id, "submitted", 10);

      await c.query("update public.daily_submissions set dials = 11 where id = $1", [row.id]);
      await c.query("update public.daily_submissions set talked_to = 9 where id = $1", [row.id]);
      await c.query("update public.daily_submissions set in_office = false where id = $1", [row.id]);

      const after = await reload(c, row.id);
      expect(after.revision_count).toBe(3);
    });
  });
});

describe("on-time status", () => {
  it("marks a submission made before the deadline as on time", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await actAs(c, a.id);
      await insertToday(c, a.id, "submitted");

      const { rows } = await c.query<{ on_time: boolean }>(
        "select on_time from public.v_daily_consultant_summary where user_id = $1",
        [a.id],
      );
      expect(rows[0]!.on_time).toBe(true);
    });
  });

  it("marks a backfilled earlier date as late", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await actAs(c, a.id);

      // Submitting three days after the fact: first_submitted_at is now, which
      // is well past that date's 23:59 Singapore deadline.
      await c.query(
        `insert into public.daily_submissions
           (user_id, business_date, dials, talked_to, campaign_status, in_office, status)
         values ($1, public.sg_today() - 3, 5, 2, 'running', true, 'submitted')`,
        [a.id],
      );

      const { rows } = await c.query<{ on_time: boolean }>(
        "select on_time from public.v_daily_consultant_summary where user_id = $1",
        [a.id],
      );
      expect(rows[0]!.on_time).toBe(false);
    });
  });

  it("keeps an on-time submission on time after a later correction", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await actAs(c, a.id);
      const row = await insertToday(c, a.id, "submitted", 10);

      await c.query("update public.daily_submissions set dials = 40 where id = $1", [row.id]);

      const { rows } = await c.query<{ on_time: boolean; revision_count: number }>(
        `select on_time, revision_count
           from public.v_daily_consultant_summary where user_id = $1`,
        [a.id],
      );
      expect(rows[0]!.on_time).toBe(true);
      expect(rows[0]!.revision_count).toBe(1);
    });
  });
});

describe("validation", () => {
  it("rejects negative dials", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await actAs(c, a.id);
      await expectRejection(() => insertToday(c, a.id, "submitted", -1));
    });
  });

  it("accepts zero as a valid day", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await actAs(c, a.id);
      const row = await insertToday(c, a.id, "submitted", 0);
      expect(row.status).toBe("submitted");
    });
  });

  it("rejects an unknown campaign status", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await actAs(c, a.id);
      await expectRejection(() =>
        c.query(
          `insert into public.daily_submissions
             (user_id, business_date, dials, talked_to, campaign_status, in_office, status)
           values ($1, public.sg_today(), 1, 1, 'maybe', true, 'submitted')`,
          [a.id],
        ),
      );
    });
  });
});

describe("appointment totals are counted, never typed", () => {
  it("moves AO/AC/FU/N as appointments are added and removed", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await actAs(c, a.id);
      const row = await insertToday(c, a.id, "submitted");
      const today = await (async () => {
        await actAs(c, a.id);
        return sgToday(c);
      })();

      await actAs(c, a.id);
      const add = (type: string, name: string) =>
        c.query(
          `insert into public.appointment_activities
             (daily_submission_id, user_id, business_date, prospect_name, appointment_type)
           values ($1, $2, $3, $4, $5) returning id`,
          [row.id, a.id, today, name, type],
        );

      await add("opening", "P1");
      await add("opening", "P2");
      await add("closing", "P3");
      const { rows: fu } = await add("follow_up", "P4");
      await add("nomination", "P5");

      const summary1 = await c.query<{
        appointments_opening: string;
        appointments_closing: string;
        appointments_follow_up: string;
        appointments_nomination: string;
      }>(
        `select appointments_opening, appointments_closing,
                appointments_follow_up, appointments_nomination
           from public.v_daily_consultant_summary where submission_id = $1`,
        [row.id],
      );
      expect(Number(summary1.rows[0]!.appointments_opening)).toBe(2);
      expect(Number(summary1.rows[0]!.appointments_closing)).toBe(1);
      expect(Number(summary1.rows[0]!.appointments_follow_up)).toBe(1);
      expect(Number(summary1.rows[0]!.appointments_nomination)).toBe(1);

      // Changing a type moves the count from one bucket to another.
      await c.query(
        "update public.appointment_activities set appointment_type = 'closing' where id = $1",
        [fu[0]!.id],
      );
      const summary2 = await c.query<{
        appointments_closing: string;
        appointments_follow_up: string;
      }>(
        `select appointments_closing, appointments_follow_up
           from public.v_daily_consultant_summary where submission_id = $1`,
        [row.id],
      );
      expect(Number(summary2.rows[0]!.appointments_closing)).toBe(2);
      expect(Number(summary2.rows[0]!.appointments_follow_up)).toBe(0);

      // Removing one drops the count again.
      await c.query("delete from public.appointment_activities where id = $1", [
        fu[0]!.id,
      ]);
      const summary3 = await c.query<{ appointments_closing: string }>(
        `select appointments_closing
           from public.v_daily_consultant_summary where submission_id = $1`,
        [row.id],
      );
      expect(Number(summary3.rows[0]!.appointments_closing)).toBe(1);
    });
  });

  it("rejects an appointment with a blank prospect name", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await actAs(c, a.id);
      const row = await insertToday(c, a.id, "submitted");
      const today = await sgToday(c);

      await actAs(c, a.id);
      await expectRejection(() =>
        c.query(
          `insert into public.appointment_activities
             (daily_submission_id, user_id, business_date, prospect_name, appointment_type)
           values ($1, $2, $3, '   ', 'opening')`,
          [row.id, a.id, today],
        ),
      );
    });
  });
});
