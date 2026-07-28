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

type Client = Parameters<Parameters<typeof withRollback>[0]>[0];

async function subscribe(c: Client, userId: string, endpoint: string) {
  return c.query(
    `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
     values ($1, $2, 'key', 'auth') returning id`,
    [userId, endpoint],
  );
}

describe("push subscriptions", () => {
  it("lets someone subscribe their own device", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await actAs(c, a.id);
      await subscribe(c, a.id, "https://push.example/aaa");

      const { rows } = await c.query("select * from public.push_subscriptions");
      expect(rows).toHaveLength(1);
    });
  });

  it("allows one person several devices", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await actAs(c, a.id);
      await subscribe(c, a.id, "https://push.example/phone");
      await subscribe(c, a.id, "https://push.example/laptop");

      const { rows } = await c.query("select * from public.push_subscriptions");
      expect(rows).toHaveLength(2);
    });
  });

  it("updates rather than duplicating when the same device re-subscribes", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await actAs(c, a.id);
      await subscribe(c, a.id, "https://push.example/phone");

      // Opening the app again returns the same endpoint. Without the upsert
      // this would double every notification.
      await c.query(
        `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
         values ($1, 'https://push.example/phone', 'newkey', 'newauth')
         on conflict (endpoint) do update
           set p256dh = excluded.p256dh, auth = excluded.auth, failure_count = 0`,
        [a.id],
      );

      const { rows } = await c.query<{ p256dh: string }>(
        "select p256dh from public.push_subscriptions",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.p256dh).toBe("newkey");
    });
  });

  it("rejects a second row for the same endpoint outright", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await actAs(c, a.id);
      await subscribe(c, a.id, "https://push.example/phone");

      const err = await expectRejection(() =>
        subscribe(c, a.id, "https://push.example/phone"),
      );
      expect(err.message).toMatch(/duplicate key|unique/i);
    });
  });

  it("hides one person's devices from another", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const b = await seedUser(c);
      await asOwner(c);
      await subscribe(c, b.id, "https://push.example/bbb");

      await actAs(c, a.id);
      const { rows } = await c.query("select * from public.push_subscriptions");
      expect(rows).toHaveLength(0);
    });
  });

  it("stops someone subscribing a device on another person's behalf", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const b = await seedUser(c);
      await actAs(c, a.id);

      await expectRejection(() =>
        subscribe(c, b.id, "https://push.example/forged"),
      );
    });
  });

  it("lets someone genuinely delete their own subscription", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await actAs(c, a.id);
      await subscribe(c, a.id, "https://push.example/phone");

      // Turning notifications off has to actually remove it, or the phone
      // keeps buzzing after being asked to stop.
      await c.query("delete from public.push_subscriptions where user_id = $1", [
        a.id,
      ]);
      const { rows } = await c.query("select * from public.push_subscriptions");
      expect(rows).toHaveLength(0);
    });
  });

  it("removes a person's devices when their account is deleted", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await asOwner(c);
      await subscribe(c, a.id, "https://push.example/phone");

      await c.query("delete from auth.users where id = $1", [a.id]);
      const { rows } = await c.query("select * from public.push_subscriptions");
      expect(rows).toHaveLength(0);
    });
  });
});

describe("hourly push nag logging", () => {
  it("accepts a push reminder type", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const today = await sgToday(c);
      await asOwner(c);

      await c.query(
        `insert into public.reminder_logs (user_id, business_date, reminder_type, status)
         values ($1, $2, 'push_17', 'sent')`,
        [a.id, today],
      );
      const { rows } = await c.query("select * from public.reminder_logs");
      expect(rows).toHaveLength(1);
    });
  });

  it("keeps each hour separate so one nag does not block the next", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const today = await sgToday(c);
      await asOwner(c);

      for (const hour of [17, 18, 19, 20, 21, 22, 23]) {
        await c.query(
          `insert into public.reminder_logs (user_id, business_date, reminder_type, status)
           values ($1, $2, $3, 'sent')`,
          [a.id, today, `push_${hour}`],
        );
      }

      const { rows } = await c.query("select * from public.reminder_logs");
      expect(rows).toHaveLength(7);
    });
  });

  it("still blocks a repeat within the same hour", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const today = await sgToday(c);
      await asOwner(c);

      await c.query(
        `insert into public.reminder_logs (user_id, business_date, reminder_type, status)
         values ($1, $2, 'push_19', 'sent')`,
        [a.id, today],
      );

      // A Netlify retry at 19:00 must not buzz the same phone twice.
      const err = await expectRejection(() =>
        c.query(
          `insert into public.reminder_logs (user_id, business_date, reminder_type, status)
           values ($1, $2, 'push_19', 'sent')`,
          [a.id, today],
        ),
      );
      expect(err.message).toMatch(/duplicate key|unique/i);
    });
  });

  it("still rejects a nonsense reminder type", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const today = await sgToday(c);
      await asOwner(c);

      await expectRejection(() =>
        c.query(
          `insert into public.reminder_logs (user_id, business_date, reminder_type, status)
           values ($1, $2, 'push_everything', 'sent')`,
          [a.id, today],
        ),
      );
    });
  });

  it("keeps the original email reminder types working", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const today = await sgToday(c);
      await asOwner(c);

      await c.query(
        `insert into public.reminder_logs (user_id, business_date, reminder_type, status)
         values ($1, $2, 'consultant_missing', 'sent'),
                ($1, $2, 'admin_digest', 'sent')`,
        [a.id, today],
      );
      const { rows } = await c.query("select * from public.reminder_logs");
      expect(rows).toHaveLength(2);
    });
  });
});

describe("giving up on a dead device", () => {
  it("excludes a subscription once it has failed enough times", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await asOwner(c);

      await c.query(
        `insert into public.push_subscriptions
           (user_id, endpoint, p256dh, auth, failure_count)
         values ($1, 'https://push.example/dead', 'k', 'a', 5),
                ($1, 'https://push.example/alive', 'k', 'a', 2)`,
        [a.id],
      );

      // This is the filter the sender uses. A device that has failed five
      // times is not worth a request per person per hour forever.
      const { rows } = await c.query<{ endpoint: string }>(
        "select endpoint from public.push_subscriptions where failure_count < 5",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.endpoint).toContain("alive");
    });
  });

  it("counts failures upward rather than pinning them at one", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await asOwner(c);
      await c.query(
        `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
         values ($1, 'https://push.example/flaky', 'k', 'a')`,
        [a.id],
      );

      // Five consecutive failures must actually reach the threshold. Setting
      // the count to 1 each time - which is what the sender used to do - meant
      // it never did, and the give-up logic was unreachable.
      for (let i = 0; i < 5; i += 1) {
        const { rows } = await c.query<{ failure_count: number }>(
          "select failure_count from public.push_subscriptions where user_id = $1",
          [a.id],
        );
        await c.query(
          "update public.push_subscriptions set failure_count = $2 where user_id = $1",
          [a.id, rows[0]!.failure_count + 1],
        );
      }

      const { rows } = await c.query<{ failure_count: number }>(
        "select failure_count from public.push_subscriptions where user_id = $1",
        [a.id],
      );
      expect(rows[0]!.failure_count).toBe(5);

      const live = await c.query(
        "select * from public.push_subscriptions where failure_count < 5",
      );
      expect(live.rows).toHaveLength(0);
    });
  });

  it("refuses a negative failure count", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await asOwner(c);
      await expectRejection(() =>
        c.query(
          `insert into public.push_subscriptions
             (user_id, endpoint, p256dh, auth, failure_count)
           values ($1, 'https://push.example/x', 'k', 'a', -1)`,
          [a.id],
        ),
      );
    });
  });
});
