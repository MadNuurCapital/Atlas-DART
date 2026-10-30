import { describe, it, expect } from "vitest";
import {
  withRollback,
  actAs,
  asOwner,
  seedUser,
  seedInsurer,
  seedCase,
  expectRejection,
} from "./helpers.ts";

/**
 * The team feed and the notification centre.
 *
 * Two things are being asserted here, and the second matters more than the
 * first. One: celebrations appear, once, for everyone. Two: making them appear
 * did not widen what anybody can see about anybody else's business.
 */

describe("a submitted case announces itself to the team", () => {
  it("writes one event naming the advisor", async () => {
    await withRollback(async (client) => {
      const zul = await seedUser(client, { fullName: "Zul Advisor" });
      const insurer = await seedInsurer(client);
      await seedCase(client, zul.id, insurer, { gr: 900, policyType: "ILP" });

      await asOwner(client);
      const { rows } = await client.query(
        "select * from public.team_events",
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].kind).toBe("case_submitted");
      expect(rows[0].actor_name).toBe("Zul Advisor");
    });
  });

  it("every colleague sees it, not only the advisor", async () => {
    await withRollback(async (client) => {
      const zul = await seedUser(client, { fullName: "Zul Advisor" });
      const siti = await seedUser(client, { fullName: "Siti Colleague" });
      const insurer = await seedInsurer(client);
      await seedCase(client, zul.id, insurer);

      await actAs(client, siti.id);
      const { rows } = await client.query(
        "select actor_name from public.team_events",
      );

      // Siti cannot read Zul's case, his profile, or any of his figures. She
      // can read this, which is the entire point of it being its own table.
      expect(rows).toHaveLength(1);
      expect(rows[0].actor_name).toBe("Zul Advisor");
    });
  });

  it("does not announce an edit, only a new case", async () => {
    await withRollback(async (client) => {
      const zul = await seedUser(client);
      const insurer = await seedInsurer(client);
      const caseId = await seedCase(client, zul.id, insurer);

      await asOwner(client);
      await client.query(
        "update public.cases set client_name = 'Corrected Name' where id = $1",
        [caseId],
      );

      const { rows } = await client.query("select * from public.team_events");
      // Correcting a typo must not buzz fifteen people.
      expect(rows).toHaveLength(1);
    });
  });

  it("cannot announce the same case twice", async () => {
    await withRollback(async (client) => {
      const zul = await seedUser(client);
      const insurer = await seedInsurer(client);
      const caseId = await seedCase(client, zul.id, insurer);

      await asOwner(client);
      // Simulate a replayed trigger or a retried insert.
      await client.query(
        `insert into public.team_events (kind, actor_id, actor_name, case_id)
         values ('case_submitted', $1, 'Zul Advisor', $2)
         on conflict (case_id) do nothing`,
        [zul.id, caseId],
      );

      const { rows } = await client.query("select * from public.team_events");
      expect(rows).toHaveLength(1);
    });
  });
});

describe("the feed cannot leak what was agreed to stay private", () => {
  it("has no column for the product type or the amount", async () => {
    await withRollback(async (client) => {
      const { rows } = await client.query(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'team_events'`,
      );
      const columns = rows.map((r) => r.column_name as string);

      // The agreed shape is "named, no product and no amount". Enforced by the
      // table having nowhere to put either, so no later trigger can start
      // including them without a schema change somebody has to justify.
      expect(columns).not.toContain("policy_type");
      expect(columns).not.toContain("gr_amount");
      expect(columns).not.toContain("ape_amount");
      expect(columns.sort()).toEqual([
        "actor_id",
        "actor_name",
        "case_id",
        "created_at",
        "id",
        "kind",
      ]);
    });
  });

  it("holds no trace of the amount even when one was written", async () => {
    await withRollback(async (client) => {
      const zul = await seedUser(client);
      const insurer = await seedInsurer(client);
      await seedCase(client, zul.id, insurer, {
        gr: 4200,
        ape: 7777,
        policyType: "ILP",
      });

      await asOwner(client);
      const { rows } = await client.query(
        "select to_jsonb(e)::text as row from public.team_events e",
      );

      const row = rows[0].row as string;
      expect(row).not.toContain("4200");
      expect(row).not.toContain("7777");
      expect(row).not.toContain("ILP");
    });
  });

  it("does not let a colleague read the underlying case", async () => {
    await withRollback(async (client) => {
      const zul = await seedUser(client);
      const siti = await seedUser(client);
      const insurer = await seedInsurer(client);
      await seedCase(client, zul.id, insurer, { gr: 4200 });

      await actAs(client, siti.id);
      const { rows } = await client.query("select * from public.cases");

      // The celebration exists; the business behind it does not become
      // readable because of it.
      expect(rows).toHaveLength(0);
    });
  });
});

describe("nobody can forge or erase a celebration", () => {
  it("refuses an insert from a signed-in user", async () => {
    await withRollback(async (client) => {
      const siti = await seedUser(client);
      await actAs(client, siti.id);

      const err = await expectRejection(() =>
        client.query(
          `insert into public.team_events (kind, actor_id, actor_name)
           values ('case_submitted', $1, 'Siti Colleague')`,
          [siti.id],
        ),
      );
      expect(err.message).toMatch(/row-level security|permission/i);
    });
  });

  it("refuses a delete from a signed-in user", async () => {
    await withRollback(async (client) => {
      const zul = await seedUser(client);
      const siti = await seedUser(client);
      const insurer = await seedInsurer(client);
      await seedCase(client, zul.id, insurer);

      await actAs(client, siti.id);
      const err = await expectRejection(() =>
        client.query("delete from public.team_events"),
      );

      // Refused by the GRANT, before RLS is even consulted - the role has
      // SELECT on this table and nothing else. Two gates, and the outer one
      // holds on its own.
      expect(err.message).toMatch(/permission denied/i);
    });
  });
});

describe("the notification centre", () => {
  it("shows a person their own notifications and nobody else's", async () => {
    await withRollback(async (client) => {
      const mine = await seedUser(client);
      const theirs = await seedUser(client);

      await asOwner(client);
      await client.query(
        `insert into public.notifications (user_id, kind, title, dedupe_key)
         values ($1, 'streak', 'Your streak reached 5 days', 'streak_5'),
                ($2, 'streak', 'Secret to me', 'streak_5')`,
        [mine.id, theirs.id],
      );

      await actAs(client, mine.id);
      const { rows } = await client.query(
        "select public.notification_feed(50) as f",
      );

      const titles = (rows[0].f.items as { title: string }[]).map(
        (i) => i.title,
      );
      expect(titles).toContain("Your streak reached 5 days");
      expect(titles).not.toContain("Secret to me");
    });
  });

  it("merges team events and personal notifications, newest first", async () => {
    await withRollback(async (client) => {
      const zul = await seedUser(client, { fullName: "Zul Advisor" });
      const siti = await seedUser(client);
      const insurer = await seedInsurer(client);

      await asOwner(client);
      await client.query(
        `insert into public.notifications
           (user_id, kind, title, dedupe_key, created_at)
         values ($1, 'streak', 'Older personal note', 'k1', now() - interval '1 hour')`,
        [siti.id],
      );
      await seedCase(client, zul.id, insurer);

      await actAs(client, siti.id);
      const { rows } = await client.query(
        "select public.notification_feed(50) as f",
      );
      const items = rows[0].f.items as { title: string; source: string }[];

      expect(items).toHaveLength(2);
      expect(items[0]!.source).toBe("team");
      expect(items[0]!.title).toBe("Zul Advisor just submitted a case!");
      expect(items[1]!.title).toBe("Older personal note");
    });
  });

  it("counts unread over everything, not just the page fetched", async () => {
    await withRollback(async (client) => {
      const mine = await seedUser(client);

      await asOwner(client);
      for (let i = 0; i < 12; i += 1) {
        await client.query(
          `insert into public.notifications (user_id, kind, title, dedupe_key)
           values ($1, 'streak', 'Note ' || $2, 'k' || $2)`,
          [mine.id, String(i)],
        );
      }

      await actAs(client, mine.id);
      const { rows } = await client.query(
        "select public.notification_feed(5) as f",
      );

      expect(rows[0].f.items).toHaveLength(5);
      // A badge reading 5 when there are 12 unread would be worse than none.
      expect(Number(rows[0].f.unread)).toBe(12);
    });
  });

  it("does not count team events as unread", async () => {
    await withRollback(async (client) => {
      const zul = await seedUser(client);
      const siti = await seedUser(client);
      const insurer = await seedInsurer(client);
      await seedCase(client, zul.id, insurer);

      await actAs(client, siti.id);
      const { rows } = await client.query(
        "select public.notification_feed(50) as f",
      );

      // The bell is for things addressed to you. A shared row has no
      // per-person read state and would otherwise never clear.
      expect(Number(rows[0].f.unread)).toBe(0);
      expect(rows[0].f.items).toHaveLength(1);
    });
  });

  it("marks only the caller's own notifications read", async () => {
    await withRollback(async (client) => {
      const mine = await seedUser(client);
      const theirs = await seedUser(client);

      await asOwner(client);
      await client.query(
        `insert into public.notifications (user_id, kind, title, dedupe_key)
         values ($1, 'streak', 'Mine', 'k1'), ($2, 'streak', 'Theirs', 'k1')`,
        [mine.id, theirs.id],
      );

      await actAs(client, mine.id);
      const { rows } = await client.query(
        "select public.mark_notifications_read() as n",
      );
      expect(rows[0].n).toBe(1);

      await asOwner(client);
      const { rows: after } = await client.query(
        `select user_id, read_at is not null as is_read
           from public.notifications order by title`,
      );
      expect(after.find((r) => r.user_id === mine.id)!.is_read).toBe(true);
      expect(after.find((r) => r.user_id === theirs.id)!.is_read).toBe(false);
    });
  });

  it("refuses a second notification with the same dedupe key", async () => {
    await withRollback(async (client) => {
      const mine = await seedUser(client);
      await asOwner(client);

      await client.query(
        `insert into public.notifications (user_id, kind, title, dedupe_key)
         values ($1, 'streak', 'Streak of 5', 'streak_5_2026-03-02')`,
        [mine.id],
      );

      const err = await expectRejection(() =>
        client.query(
          `insert into public.notifications (user_id, kind, title, dedupe_key)
           values ($1, 'streak', 'Streak of 5 again', 'streak_5_2026-03-02')`,
          [mine.id],
        ),
      );
      // An achievement awarded twice is the fastest way to make the whole
      // system feel untrustworthy.
      expect(err.message).toMatch(/duplicate key|unique/i);
    });
  });

  it("lets two different people hold the same dedupe key", async () => {
    await withRollback(async (client) => {
      const a = await seedUser(client);
      const b = await seedUser(client);
      await asOwner(client);

      await client.query(
        `insert into public.notifications (user_id, kind, title, dedupe_key)
         values ($1, 'streak', 'Streak of 5', 'streak_5'),
                ($2, 'streak', 'Streak of 5', 'streak_5')`,
        [a.id, b.id],
      );

      const { rows } = await client.query(
        "select count(*)::int as n from public.notifications",
      );
      // The key is unique per person, not globally - everyone reaches five
      // days eventually.
      expect(rows[0].n).toBe(2);
    });
  });

  it("will not let a person claim a notification for themselves", async () => {
    await withRollback(async (client) => {
      const siti = await seedUser(client);
      await actAs(client, siti.id);

      const err = await expectRejection(() =>
        client.query(
          `insert into public.notifications (user_id, kind, title, dedupe_key)
           values ($1, 'milestone', 'I am amazing', 'self_awarded')`,
          [siti.id],
        ),
      );
      expect(err.message).toMatch(/row-level security|permission/i);
    });
  });
});
