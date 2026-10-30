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
 * day_payload() and admin_overview() finish what 0023 and 0024 started: every
 * page that asked the database more than once now asks it once.
 *
 * Same standard as before - the original queries and the new function, against
 * the same seeded data, as the same user, compared as JSON on both sides so
 * the driver's type rendering cannot be mistaken for a difference in the data.
 */

const DAY = "2026-03-02";
const YEAR = 2026;
const MONTH = 3;

describe("day_payload returns what /today's two queries returned", () => {
  it("returns the submission and its appointments, oldest first", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      await seedSubmission(client, user.id, DAY, { dials: 14, talkedTo: 6 });

      await asOwner(client);
      // appointment_activities hangs off the submission row: the parent-match
      // trigger from 0005 refuses an orphan, which is what stops anyone
      // attaching appointments to someone else's day.
      const { rows: parent } = await client.query(
        `select id from public.daily_submissions
          where user_id = $1 and business_date = $2`,
        [user.id, DAY],
      );
      for (const name of ["Aisha", "Budi", "Chandra"]) {
        await client.query(
          `insert into public.appointment_activities
             (daily_submission_id, user_id, business_date, prospect_name,
              appointment_type)
           values ($1, $2, $3, $4, 'opening')`,
          [parent[0].id, user.id, DAY, name],
        );
      }

      await actAs(client, user.id);

      const direct = await client.query(
        `select
           (select to_jsonb(d) from public.daily_submissions d
             where d.user_id = auth.uid() and d.business_date = $1) as submission,
           coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at)
                       from public.appointment_activities a
                      where a.user_id = auth.uid()
                        and a.business_date = $1), '[]'::jsonb) as appointments`,
        [DAY],
      );

      const { rows } = await client.query(
        "select public.day_payload($1) as p",
        [DAY],
      );

      expect(rows[0].p.submission).toEqual(direct.rows[0].submission);
      expect(rows[0].p.appointments).toEqual(direct.rows[0].appointments);

      // AO/AC/FU/N are counted from these rows and never typed, so a lost row
      // here would silently change someone's totals.
      expect(rows[0].p.appointments).toHaveLength(3);
      expect(
        (rows[0].p.appointments as { prospect_name: string }[]).map(
          (a) => a.prospect_name,
        ),
      ).toEqual(["Aisha", "Budi", "Chandra"]);
    });
  });

  it("returns a null submission and no appointments for an untouched day", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      await actAs(client, user.id);

      const { rows } = await client.query(
        "select public.day_payload($1) as p",
        [DAY],
      );

      // The form renders this as empty. A thrown error, or an array that was
      // null, would be an error screen on a perfectly ordinary day.
      expect(rows[0].p.submission).toBeNull();
      expect(rows[0].p.appointments).toEqual([]);
    });
  });

  it("reads an older day, because the edit window governs writing not reading", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      // Far outside the 7-day window. The arrows at the top of /today must
      // still be able to show it.
      await seedSubmission(client, user.id, "2025-01-05", { dials: 3 });
      await actAs(client, user.id);

      const { rows } = await client.query(
        "select public.day_payload($1) as p",
        ["2025-01-05"],
      );
      expect(rows[0].p.submission.dials).toBe(3);
    });
  });

  it("never returns another person's day", async () => {
    await withRollback(async (client) => {
      const mine = await seedUser(client);
      const theirs = await seedUser(client);
      await seedSubmission(client, theirs.id, DAY, { dials: 77 });

      await actAs(client, mine.id);
      const { rows } = await client.query(
        "select public.day_payload($1) as p",
        [DAY],
      );

      expect(rows[0].p.submission).toBeNull();
      expect(JSON.stringify(rows[0].p)).not.toContain(theirs.id);
    });
  });

  it("is SECURITY INVOKER", async () => {
    await withRollback(async (client) => {
      const { rows } = await client.query(
        "select prosecdef from pg_proc where proname = 'day_payload'",
      );
      expect(rows[0].prosecdef).toBe(false);
    });
  });
});

describe("admin_overview returns what the admin page's three queries returned", () => {
  it("agrees with team_daily, v_target_shortfall and monthly_compliance", async () => {
    await withRollback(async (client) => {
      const admin = await seedUser(client, {
        role: "admin",
        fullName: "Aaliyah Admin",
      });
      const consultant = await seedUser(client, { fullName: "Zul Advisor" });
      const insurer = await seedInsurer(client);

      await seedSubmission(client, consultant.id, DAY, { dials: 12 });
      await seedCase(client, consultant.id, insurer, {
        dateSubmitted: "2026-03-10",
        gr: 900,
      });

      await actAs(client, admin.id);

      const direct = await client.query(
        `select
           coalesce((select jsonb_agg(to_jsonb(t) order by t.full_name)
                       from public.team_daily($1) t), '[]'::jsonb) as team,
           coalesce((select jsonb_agg(to_jsonb(s) order by s.full_name)
                       from public.v_target_shortfall s), '[]'::jsonb) as targets,
           coalesce((select jsonb_agg(to_jsonb(c) order by c.full_name)
                       from public.monthly_compliance($2,$3) c), '[]'::jsonb) as compliance`,
        [DAY, YEAR, MONTH],
      );

      const { rows } = await client.query(
        "select public.admin_overview($1,$2,$3) as p",
        [DAY, YEAR, MONTH],
      );

      expect(rows[0].p.team).toEqual(direct.rows[0].team);
      expect(rows[0].p.targets).toEqual(direct.rows[0].targets);
      expect(rows[0].p.compliance).toEqual(direct.rows[0].compliance);

      // An admin sees the whole team, not just themselves.
      const names = (rows[0].p.team as { full_name: string }[]).map(
        (t) => t.full_name,
      );
      expect(names).toContain("Aaliyah Admin");
      expect(names).toContain("Zul Advisor");
    });
  });

  it("orders the team by name, so the board does not reshuffle", async () => {
    await withRollback(async (client) => {
      const admin = await seedUser(client, {
        role: "admin",
        fullName: "Mid Admin",
      });
      await seedUser(client, { fullName: "Zed Last" });
      await seedUser(client, { fullName: "Abu First" });

      await actAs(client, admin.id);
      const { rows } = await client.query(
        "select public.admin_overview($1,$2,$3) as p",
        [DAY, YEAR, MONTH],
      );

      const names = (rows[0].p.team as { full_name: string }[]).map(
        (t) => t.full_name,
      );
      expect(names).toEqual([...names].sort());
    });
  });

  it("shows a consultant only themselves, exactly as the wrapped functions do", async () => {
    await withRollback(async (client) => {
      const consultant = await seedUser(client, { fullName: "Only Me" });
      await seedUser(client, { fullName: "Someone Else" });

      await actAs(client, consultant.id);
      const { rows } = await client.query(
        "select public.admin_overview($1,$2,$3) as p",
        [DAY, YEAR, MONTH],
      );

      // The page itself is gated by requireAdmin(); this proves the function
      // is not a way around that even if it were called directly.
      expect(JSON.stringify(rows[0].p)).not.toContain("Someone Else");
    });
  });

  it("is SECURITY INVOKER", async () => {
    await withRollback(async (client) => {
      const { rows } = await client.query(
        "select prosecdef from pg_proc where proname = 'admin_overview'",
      );
      expect(rows[0].prosecdef).toBe(false);
    });
  });
});
