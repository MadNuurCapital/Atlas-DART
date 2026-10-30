import { describe, it, expect } from "vitest";
import {
  withRollback,
  actAs,
  asOwner,
  seedUser,
  seedSubmission,
  seedInsurer,
  seedCase,
} from "./helpers.ts";

/**
 * dashboard_payload() replaces the five separate queries the dashboard used to
 * issue, to save four round trips to a database on the other side of the
 * world.
 *
 * A speed change that quietly alters a figure is not a speed change, it is a
 * data bug wearing a disguise - and on this dashboard the figures are
 * somebody's commission. So these tests do not check that the function returns
 * something reasonable. They run the ORIGINAL queries and the NEW function
 * against the same seeded data, as the same user, and demand the answers match
 * exactly.
 */

const YEAR = 2026;
const MONTH = 3;
const FROM = "2026-03-01";
const TO = "2026-03-31";

describe("dashboard_payload returns what the five queries returned", () => {
  it("agrees with v_daily_consultant_summary, day for day", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      await seedSubmission(client, user.id, "2026-03-02", { dials: 11 });
      await seedSubmission(client, user.id, "2026-03-03", {
        dials: 7,
        status: "draft",
      });
      await seedSubmission(client, user.id, "2026-03-04", { dials: 23 });

      await actAs(client, user.id);

      // Both sides are asked for JSON, so this compares the DATA rather than
      // the driver: node-pg renders a `date` as a JS Date and a `numeric` as a
      // string, while PostgREST - which is what the app actually talks to -
      // renders both exactly as this function does.
      const direct = await client.query(
        `select coalesce(jsonb_agg(to_jsonb(d) order by d.business_date), '[]'::jsonb) as rows
           from public.v_daily_consultant_summary d
          where d.user_id = auth.uid()
            and d.business_date >= $1 and d.business_date <= $2`,
        [FROM, TO],
      );

      const { rows } = await client.query(
        "select public.dashboard_payload($1,$2,$3,$4) as p",
        [FROM, TO, YEAR, MONTH],
      );

      // Every column of every row, exactly.
      expect(rows[0].p.days).toEqual(direct.rows[0].rows);
      expect(rows[0].p.days).toHaveLength(3);
    });
  });

  it("agrees with v_target_shortfall and v_case_mix_by_category", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      const insurer = await seedInsurer(client);
      await seedCase(client, user.id, insurer, {
        dateSubmitted: "2026-03-10",
        policyType: "ILP",
        gr: 800,
        ape: 1200,
      });
      await seedCase(client, user.id, insurer, {
        dateSubmitted: "2026-03-12",
        policyType: "Term",
        gr: 450,
        ape: 900,
      });

      await actAs(client, user.id);

      const direct = await client.query(
        `select
           (select to_jsonb(t) from public.v_target_shortfall t
             where t.consultant_id = auth.uid() limit 1) as target,
           coalesce((select jsonb_agg(to_jsonb(m) order by m.policy_type)
                       from public.v_case_mix_by_category m
                      where m.consultant_id = auth.uid()
                        and m.year = $1 and m.month = $2), '[]'::jsonb) as mix`,
        [YEAR, MONTH],
      );

      const { rows } = await client.query(
        "select public.dashboard_payload($1,$2,$3,$4) as p",
        [FROM, TO, YEAR, MONTH],
      );
      const p = rows[0].p;

      // Column for column, including every currency figure.
      expect(p.target).toEqual(direct.rows[0].target);
      expect(p.mix).toEqual(direct.rows[0].mix);
      expect(p.mix).toHaveLength(2);

      // And the figures are the seeded ones, so a pair of matching nulls
      // cannot pass this test.
      const gr = Object.fromEntries(
        (p.mix as Record<string, unknown>[]).map((m) => [m.policy_type, m.gr]),
      );
      expect(Number(gr.ILP)).toBe(800);
      expect(Number(gr.Term)).toBe(450);
    });
  });

  /**
   * The coach's name comes back NULL for a consultant, and that is not a
   * regression - it is what the query this replaces already did.
   *
   * Row Level Security on `profiles` is `(id = auth.uid()) OR is_admin()`, so
   * a consultant can read exactly one profile row: their own. The PostgREST
   * embed the page used before hit the same policy and got the same null.
   *
   * It is, separately, almost certainly not what anyone intended - a consultant
   * cannot see who their own coaching session is with. That is a product
   * decision to make deliberately, not something to fix inside a performance
   * change, so this test pins the behaviour as it stands today and the parity
   * assertion below proves old and new agree.
   */
  it("resolves the coach's name exactly as the query it replaces did", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      const coach = await seedUser(client, {
        role: "admin",
        fullName: "Rahim Coach",
      });

      await asOwner(client);
      await client.query(
        `insert into public.coaching_sessions
           (consultant_id, coach_id, created_by, title, category,
            scheduled_at, status)
         values ($1, $2, $2, 'Pipeline review', 'monthly_review',
                 '2026-03-20T06:00:00Z', 'scheduled')`,
        [user.id, coach.id],
      );

      await actAs(client, user.id);

      // The same join the page's embed performed, under the same policies.
      const direct = await client.query(
        `select p.full_name as coach_name, c.title
           from public.coaching_sessions c
           left join public.profiles p on p.id = c.coach_id`,
      );

      const { rows } = await client.query(
        "select public.dashboard_payload($1,$2,$3,$4) as p",
        [FROM, TO, YEAR, MONTH],
      );

      expect(rows[0].p.coaching).toHaveLength(1);
      expect(rows[0].p.coaching[0].title).toBe("Pipeline review");
      expect(rows[0].p.coaching[0].title).toBe(direct.rows[0].title);

      // Identical to the old path, whatever that path produced.
      expect(rows[0].p.coaching[0].coach_name).toBe(direct.rows[0].coach_name);
      expect(direct.rows[0].coach_name).toBeNull();
    });
  });

  it("does resolve the coach's name for an admin, who may read profiles", async () => {
    await withRollback(async (client) => {
      const admin = await seedUser(client, {
        role: "admin",
        fullName: "Rahim Coach",
      });

      await asOwner(client);
      await client.query(
        `insert into public.coaching_sessions
           (consultant_id, coach_id, created_by, title, category,
            scheduled_at, status)
         values ($1, $1, $1, 'Own review', 'monthly_review',
                 '2026-03-20T06:00:00Z', 'scheduled')`,
        [admin.id],
      );

      await actAs(client, admin.id);
      const { rows } = await client.query(
        "select public.dashboard_payload($1,$2,$3,$4) as p",
        [FROM, TO, YEAR, MONTH],
      );

      // Proves the join itself works, and that the null above is the policy
      // talking rather than a broken query.
      expect(rows[0].p.coaching[0].coach_name).toBe("Rahim Coach");
    });
  });
});

describe("dashboard_payload cannot be pointed at anyone else", () => {
  it("shows a consultant only their own figures", async () => {
    await withRollback(async (client) => {
      const mine = await seedUser(client);
      const theirs = await seedUser(client);

      await seedSubmission(client, mine.id, "2026-03-02", { dials: 11 });
      await seedSubmission(client, theirs.id, "2026-03-02", { dials: 99 });

      await actAs(client, mine.id);
      const { rows } = await client.query(
        "select public.dashboard_payload($1,$2,$3,$4) as p",
        [FROM, TO, YEAR, MONTH],
      );

      const days = rows[0].p.days as Record<string, unknown>[];
      expect(days).toHaveLength(1);
      expect(days[0]!.dials).toBe(11);

      // Their row must be absent, not merely filtered on one field. Checked by
      // user id rather than by searching the JSON for "99", which matched a
      // uuid the first time it ran and would have passed for the wrong reason.
      expect(days.every((d) => d.user_id === mine.id)).toBe(true);
      expect(JSON.stringify(rows[0].p)).not.toContain(theirs.id);
    });
  });

  it("takes no user id, so there is no parameter to point elsewhere", async () => {
    await withRollback(async (client) => {
      const { rows } = await client.query(
        `select count(*)::int as n
           from pg_proc
          where proname = 'dashboard_payload'
            and pronargs = 4`,
      );
      expect(rows[0].n).toBe(1);
    });
  });

  it("is SECURITY INVOKER, so RLS is still the boundary", async () => {
    await withRollback(async (client) => {
      const { rows } = await client.query(
        "select prosecdef from pg_proc where proname = 'dashboard_payload'",
      );
      // prosecdef true would mean SECURITY DEFINER - the function would run as
      // its owner and every policy above would stop applying.
      expect(rows[0].prosecdef).toBe(false);
    });
  });

  it("gives an anonymous caller nothing", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      await seedSubmission(client, user.id, "2026-03-02", { dials: 11 });

      await actAs(client, null);
      const { rows } = await client.query(
        "select public.dashboard_payload($1,$2,$3,$4) as p",
        [FROM, TO, YEAR, MONTH],
      );

      expect(rows[0].p.days).toEqual([]);
      expect(rows[0].p.target).toBeNull();
      expect(rows[0].p.mix).toEqual([]);
      expect(rows[0].p.coaching).toEqual([]);
    });
  });
});

describe("dashboard_payload on an empty account", () => {
  it("returns empty arrays rather than null, so the page renders zeros", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      await actAs(client, user.id);

      const { rows } = await client.query(
        "select public.dashboard_payload($1,$2,$3,$4) as p",
        [FROM, TO, YEAR, MONTH],
      );
      const p = rows[0].p;

      // A null here would reach the page as `.length of undefined`. Someone's
      // first day must not be an error screen.
      expect(p.days).toEqual([]);
      expect(p.mix).toEqual([]);
      expect(p.coaching).toEqual([]);
      expect(p.pending).toBeNull();
    });
  });
});
