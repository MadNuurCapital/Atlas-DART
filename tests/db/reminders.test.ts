import { describe, it, expect, afterAll } from "vitest";
import {
  pool,
  withRollback,
  actAs,
  asOwner,
  seedUser,
  seedSubmission,
  sgToday,
  expectRejection,
} from "./helpers";

afterAll(async () => {
  await pool.end();
});

type Client = Parameters<Parameters<typeof withRollback>[0]>[0];

async function missing(c: Client, date: string) {
  const { rows } = await c.query<{ user_id: string; full_name: string }>(
    "select user_id, full_name from public.missing_submissions($1)",
    [date],
  );
  return rows;
}

describe("who gets chased", () => {
  it("does not chase someone who submitted", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const today = await sgToday(c);
      await seedSubmission(c, a.id, today, { status: "submitted" });

      await asOwner(c);
      expect((await missing(c, today)).map((r) => r.user_id)).not.toContain(a.id);
    });
  });

  it("chases someone with only a draft", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const today = await sgToday(c);
      await seedSubmission(c, a.id, today, { status: "draft" });

      await asOwner(c);
      // A half-filled form is not a submission.
      expect((await missing(c, today)).map((r) => r.user_id)).toContain(a.id);
    });
  });

  it("chases someone with no record at all", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const today = await sgToday(c);
      await asOwner(c);
      expect((await missing(c, today)).map((r) => r.user_id)).toContain(a.id);
    });
  });

  it("chases admins too, because they submit as well", async () => {
    await withRollback(async (c) => {
      const admin = await seedUser(c, { role: "admin" });
      const today = await sgToday(c);
      await asOwner(c);
      expect((await missing(c, today)).map((r) => r.user_id)).toContain(admin.id);
    });
  });

  it("never chases a deactivated leaver", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await asOwner(c);
      await c.query("update public.profiles set active = false where id = $1", [
        a.id,
      ]);

      const today = await sgToday(c);
      expect((await missing(c, today)).map((r) => r.user_id)).not.toContain(a.id);
    });
  });

  it("answers for a past date independently of today", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const today = await sgToday(c);
      await seedSubmission(c, a.id, today, { status: "submitted" });

      await asOwner(c);
      const { rows } = await c.query<{ d: string }>(
        "select (public.sg_today() - 3)::text as d",
      );
      const threeDaysAgo = rows[0]!.d;

      // Submitted today, but nothing for that earlier date.
      expect((await missing(c, threeDaysAgo)).map((r) => r.user_id)).toContain(
        a.id,
      );
    });
  });
});

describe("a retry cannot send twice", () => {
  it("rejects a duplicate log row for the same person, day and type", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const today = await sgToday(c);
      await asOwner(c);

      await c.query(
        `insert into public.reminder_logs (user_id, business_date, reminder_type, status)
         values ($1, $2, 'consultant_missing', 'sent')`,
        [a.id, today],
      );

      const err = await expectRejection(() =>
        c.query(
          `insert into public.reminder_logs (user_id, business_date, reminder_type, status)
           values ($1, $2, 'consultant_missing', 'sent')`,
          [a.id, today],
        ),
      );
      expect(err.message).toMatch(/duplicate key|unique/i);
    });
  });

  it("lets an upsert turn a failure into a success without duplicating", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const today = await sgToday(c);
      await asOwner(c);

      await c.query(
        `insert into public.reminder_logs
           (user_id, business_date, reminder_type, status, error_message)
         values ($1, $2, 'consultant_missing', 'failed', 'Resend 503')`,
        [a.id, today],
      );

      await c.query(
        `insert into public.reminder_logs
           (user_id, business_date, reminder_type, status, error_message)
         values ($1, $2, 'consultant_missing', 'sent', null)
         on conflict (user_id, business_date, reminder_type)
         do update set status = excluded.status, error_message = null`,
        [a.id, today],
      );

      const { rows } = await c.query<{ status: string; n: string }>(
        `select status, count(*) over () as n from public.reminder_logs
          where user_id = $1 and business_date = $2`,
        [a.id, today],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("sent");
    });
  });

  it("allows the consultant nudge and the admin digest on the same day", async () => {
    await withRollback(async (c) => {
      const admin = await seedUser(c, { role: "admin" });
      const today = await sgToday(c);
      await asOwner(c);

      await c.query(
        `insert into public.reminder_logs (user_id, business_date, reminder_type, status)
         values ($1, $2, 'consultant_missing', 'sent'),
                ($1, $2, 'admin_digest', 'sent')`,
        [admin.id, today],
      );

      const { rows } = await c.query("select * from public.reminder_logs");
      expect(rows).toHaveLength(2);
    });
  });
});

describe("failures are recorded, not swallowed", () => {
  it("refuses a failed row with no explanation", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const today = await sgToday(c);
      await asOwner(c);

      const err = await expectRejection(() =>
        c.query(
          `insert into public.reminder_logs (user_id, business_date, reminder_type, status)
           values ($1, $2, 'consultant_missing', 'failed')`,
          [a.id, today],
        ),
      );
      expect(err.message).toMatch(/reminder_logs_failure_has_reason/i);
    });
  });

  it("keeps the error text for a failure", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const today = await sgToday(c);
      await asOwner(c);

      await c.query(
        `insert into public.reminder_logs
           (user_id, business_date, reminder_type, status, error_message)
         values ($1, $2, 'consultant_missing', 'failed', 'Resend 422: invalid recipient')`,
        [a.id, today],
      );

      const { rows } = await c.query<{ error_message: string }>(
        "select error_message from public.reminder_logs where user_id = $1",
        [a.id],
      );
      expect(rows[0]!.error_message).toMatch(/invalid recipient/);
    });
  });

  it("lets a consultant see they were chased, but not anyone else", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const b = await seedUser(c);
      const today = await sgToday(c);
      await asOwner(c);

      await c.query(
        `insert into public.reminder_logs (user_id, business_date, reminder_type, status)
         values ($1, $2, 'consultant_missing', 'sent'),
                ($3, $2, 'consultant_missing', 'sent')`,
        [a.id, today, b.id],
      );

      await actAs(c, a.id);
      const { rows } = await c.query<{ user_id: string }>(
        "select user_id from public.reminder_logs",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.user_id).toBe(a.id);
    });
  });
});
