import { describe, it, expect, afterAll } from "vitest";
import {
  pool,
  withRollback,
  actAs,
  asOwner,
  seedUser,
  seedSubmission,
  seedInsurer,
  seedCase,
  sgToday,
  expectRejection,
} from "./helpers";

afterAll(async () => {
  await pool.end();
});

describe("RLS harness integrity", () => {
  // If this ever fails, every other test in this file is meaningless: it would
  // mean the tests are running as a role that bypasses Row Level Security and
  // are therefore proving nothing.
  it("binds policies to the authenticated role", async () => {
    await withRollback(async (c) => {
      await seedUser(c, { role: "consultant" });
      await actAs(c, null);

      const { rows } = await c.query("select * from public.profiles");
      expect(rows).toHaveLength(0);

      const who = await c.query<{ u: string; bypass: boolean }>(
        `select current_user as u,
                (select rolbypassrls from pg_roles where rolname = current_user) as bypass`,
      );
      expect(who.rows[0]!.u).toBe("authenticated");
      expect(who.rows[0]!.bypass).toBe(false);
    });
  });

  it("has row level security forced on every user table", async () => {
    await withRollback(async (c) => {
      await asOwner(c);
      const { rows } = await c.query<{ relname: string; forced: boolean }>(
        `select relname, relforcerowsecurity as forced
           from pg_class
          where relnamespace = 'public'::regnamespace
            and relkind = 'r'
          order by relname`,
      );
      expect(rows.length).toBeGreaterThanOrEqual(8);
      for (const row of rows) {
        expect(row.forced, `${row.relname} must force RLS`).toBe(true);
      }
    });
  });
});

describe("cross-consultant isolation", () => {
  it("hides another consultant's daily submissions", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const b = await seedUser(c);
      const today = await sgToday(c);
      await seedSubmission(c, b.id, today, { dials: 99 });

      await actAs(c, a.id);
      const { rows } = await c.query("select * from public.daily_submissions");
      expect(rows).toHaveLength(0);
    });
  });

  it("hides another consultant's appointments", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const b = await seedUser(c);
      const today = await sgToday(c);
      const submissionId = await seedSubmission(c, b.id, today);

      await asOwner(c);
      await c.query(
        `insert into public.appointment_activities
           (daily_submission_id, user_id, business_date, prospect_name, appointment_type)
         values ($1, $2, $3, 'Someone Else', 'opening')`,
        [submissionId, b.id, today],
      );

      await actAs(c, a.id);
      const { rows } = await c.query(
        "select * from public.appointment_activities",
      );
      expect(rows).toHaveLength(0);
    });
  });

  it("hides another consultant's cases", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const b = await seedUser(c);
      const insurer = await seedInsurer(c);
      await seedCase(c, b.id, insurer, { gr: 5000 });

      await actAs(c, a.id);
      const { rows } = await c.query("select * from public.cases");
      expect(rows).toHaveLength(0);
    });
  });

  it("lets an admin read the whole team", async () => {
    await withRollback(async (c) => {
      const admin = await seedUser(c, { role: "admin" });
      const b = await seedUser(c);
      const insurer = await seedInsurer(c);
      const today = await sgToday(c);
      await seedSubmission(c, b.id, today);
      await seedCase(c, b.id, insurer);

      await actAs(c, admin.id);
      const subs = await c.query("select * from public.daily_submissions");
      const cases = await c.query("select * from public.cases");
      expect(subs.rows.length).toBeGreaterThanOrEqual(1);
      expect(cases.rows.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("does not leak another consultant through the summary view", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const b = await seedUser(c);
      const today = await sgToday(c);
      await seedSubmission(c, b.id, today);

      await actAs(c, a.id);
      const { rows } = await c.query(
        "select * from public.v_daily_consultant_summary",
      );
      expect(rows).toHaveLength(0);
    });
  });
});

describe("privilege escalation", () => {
  it("stops a consultant promoting themselves to admin", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await actAs(c, a.id);

      const err = await expectRejection(() =>
        c.query("update public.profiles set role = 'admin' where id = $1", [
          a.id,
        ]),
      );
      expect(err.message).toMatch(/only an admin may change a role/i);
    });
  });

  it("stops a consultant reactivating or deactivating an account", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await actAs(c, a.id);

      const err = await expectRejection(() =>
        c.query("update public.profiles set active = false where id = $1", [
          a.id,
        ]),
      );
      expect(err.message).toMatch(/only an admin may activate/i);
    });
  });

  it("lets a consultant edit their own name", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await actAs(c, a.id);

      await c.query("update public.profiles set full_name = $2 where id = $1", [
        a.id,
        "Renamed Person",
      ]);
      const { rows } = await c.query<{ full_name: string }>(
        "select full_name from public.profiles where id = $1",
        [a.id],
      );
      expect(rows[0]!.full_name).toBe("Renamed Person");
    });
  });

  it("stops a consultant setting their own target", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await actAs(c, a.id);

      await expectRejection(() =>
        c.query(
          `insert into public.consultant_targets
             (consultant_id, period_type, year, gr_target)
           values ($1, 'yearly', 2026, 999999)`,
          [a.id],
        ),
      );
    });
  });

  it("lets an admin set a target", async () => {
    await withRollback(async (c) => {
      const admin = await seedUser(c, { role: "admin" });
      const b = await seedUser(c);
      await actAs(c, admin.id);

      await c.query(
        `insert into public.consultant_targets
           (consultant_id, period_type, year, gr_target)
         values ($1, 'yearly', 2026, 120000)`,
        [b.id],
      );
      const { rows } = await c.query("select * from public.consultant_targets");
      expect(rows).toHaveLength(1);
    });
  });

  it("stops an appointment being attached to someone else's submission", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const b = await seedUser(c);
      const today = await sgToday(c);
      const bSubmission = await seedSubmission(c, b.id, today);

      await actAs(c, a.id);
      // A forges user_id as their own but points at B's submission. The parent
      // trigger rewrites user_id to B, and the RLS WITH CHECK then rejects it.
      await expectRejection(() =>
        c.query(
          `insert into public.appointment_activities
             (daily_submission_id, user_id, business_date, prospect_name, appointment_type)
           values ($1, $2, $3, 'Forged', 'opening')`,
          [bSubmission, a.id, today],
        ),
      );
    });
  });
});

describe("edit window (decision D2)", () => {
  it("allows a consultant to write inside the 7-day window", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await actAs(c, a.id);

      await c.query(
        `insert into public.daily_submissions
           (user_id, business_date, dials, talked_to, campaign_status, in_office, status)
         values ($1, public.sg_today() - 3, 5, 2, 'running', true, 'submitted')`,
        [a.id],
      );
      const { rows } = await c.query("select * from public.daily_submissions");
      expect(rows).toHaveLength(1);
    });
  });

  it("rejects a write on day 8", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await actAs(c, a.id);

      await expectRejection(() =>
        c.query(
          `insert into public.daily_submissions
             (user_id, business_date, dials, talked_to, campaign_status, in_office, status)
           values ($1, public.sg_today() - 8, 5, 2, 'running', true, 'submitted')`,
          [a.id],
        ),
      );
    });
  });

  it("rejects a submission dated in the future", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await actAs(c, a.id);

      await expectRejection(() =>
        c.query(
          `insert into public.daily_submissions
             (user_id, business_date, dials, talked_to, campaign_status, in_office, status)
           values ($1, public.sg_today() + 1, 5, 2, 'running', true, 'submitted')`,
          [a.id],
        ),
      );
    });
  });

  it("lets an admin write outside the window", async () => {
    await withRollback(async (c) => {
      const admin = await seedUser(c, { role: "admin" });
      const b = await seedUser(c);
      await actAs(c, admin.id);

      await c.query(
        `insert into public.daily_submissions
           (user_id, business_date, dials, talked_to, campaign_status, in_office, status)
         values ($1, public.sg_today() - 60, 5, 2, 'running', true, 'submitted')`,
        [b.id],
      );
      const { rows } = await c.query("select * from public.daily_submissions");
      expect(rows).toHaveLength(1);
    });
  });
});

describe("deletion is impossible (decision D15)", () => {
  it("refuses to delete a case, even as an admin", async () => {
    await withRollback(async (c) => {
      const admin = await seedUser(c, { role: "admin" });
      const b = await seedUser(c);
      const insurer = await seedInsurer(c);
      const caseId = await seedCase(c, b.id, insurer);

      await actAs(c, admin.id);
      const err = await expectRejection(() =>
        c.query("delete from public.cases where id = $1", [caseId]),
      );
      expect(err.message).toMatch(/permission denied|policy/i);
    });
  });

  it("refuses to delete a case as its owner", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const insurer = await seedInsurer(c);
      const caseId = await seedCase(c, a.id, insurer);

      await actAs(c, a.id);
      await expectRejection(() =>
        c.query("delete from public.cases where id = $1", [caseId]),
      );
    });
  });

  it("refuses to delete a daily submission", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const today = await sgToday(c);
      const id = await seedSubmission(c, a.id, today);

      await actAs(c, a.id);
      await expectRejection(() =>
        c.query("delete from public.daily_submissions where id = $1", [id]),
      );
    });
  });

  it("refuses to alter or delete an audit log entry", async () => {
    await withRollback(async (c) => {
      const admin = await seedUser(c, { role: "admin" });
      await asOwner(c);
      const { rows } = await c.query<{ id: string }>(
        `insert into public.audit_logs (actor_user_id, action, entity_type)
         values ($1, 'case_created', 'cases') returning id`,
        [admin.id],
      );
      const auditId = rows[0]!.id;

      await actAs(c, admin.id);
      await expectRejection(() =>
        c.query("update public.audit_logs set action = 'tampered' where id = $1", [
          auditId,
        ]),
      );
      await expectRejection(() =>
        c.query("delete from public.audit_logs where id = $1", [auditId]),
      );
    });
  });
});

describe("case restoration is an admin action", () => {
  it("stops a consultant un-cancelling their own case", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const insurer = await seedInsurer(c);
      const caseId = await seedCase(c, a.id, insurer, { status: "active" });

      await actAs(c, a.id);
      await c.query(
        `update public.cases
            set status = 'cancelled',
                cancellation_reason = 'Client changed mind',
                cancelled_at = now()
          where id = $1`,
        [caseId],
      );

      const err = await expectRejection(() =>
        c.query(
          `update public.cases
              set status = 'active', cancellation_reason = null, cancelled_at = null
            where id = $1`,
          [caseId],
        ),
      );
      expect(err.message).toMatch(/only an admin may restore/i);
    });
  });

  it("lets an admin restore a cancelled case", async () => {
    await withRollback(async (c) => {
      const admin = await seedUser(c, { role: "admin" });
      const b = await seedUser(c);
      const insurer = await seedInsurer(c);
      const caseId = await seedCase(c, b.id, insurer, { status: "active" });

      await asOwner(c);
      await c.query(
        `update public.cases
            set status = 'cancelled',
                cancellation_reason = 'Mistake',
                cancelled_at = now()
          where id = $1`,
        [caseId],
      );

      await actAs(c, admin.id);
      await c.query(
        `update public.cases
            set status = 'active', cancellation_reason = null, cancelled_at = null
          where id = $1`,
        [caseId],
      );

      const { rows } = await c.query<{ status: string }>(
        "select status from public.cases where id = $1",
        [caseId],
      );
      expect(rows[0]!.status).toBe("active");
    });
  });

  it("stops a case being reassigned to another consultant", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const b = await seedUser(c);
      const insurer = await seedInsurer(c);
      const caseId = await seedCase(c, a.id, insurer);

      await actAs(c, a.id);
      await expectRejection(() =>
        c.query("update public.cases set consultant_id = $2 where id = $1", [
          caseId,
          b.id,
        ]),
      );
    });
  });
});

describe("realtime publication", () => {
  // The admin board relies on these three tables emitting change events. If a
  // future migration drops one from the publication, the board silently stops
  // updating and nobody notices until a meeting.
  it("publishes the tables the admin board subscribes to", async () => {
    await withRollback(async (c) => {
      await asOwner(c);
      const { rows } = await c.query<{ tablename: string }>(
        `select tablename from pg_publication_tables
          where pubname = 'supabase_realtime' and schemaname = 'public'
          order by tablename`,
      );
      const published = rows.map((r) => r.tablename);
      expect(published).toContain("daily_submissions");
      expect(published).toContain("appointment_activities");
      expect(published).toContain("cases");
    });
  });

  it("sends the full old row so subscribers can tell what changed", async () => {
    await withRollback(async (c) => {
      await asOwner(c);
      const { rows } = await c.query<{ relname: string; identity: string }>(
        `select relname, relreplident as identity
           from pg_class
          where relnamespace = 'public'::regnamespace
            and relname in ('daily_submissions', 'appointment_activities', 'cases')
          order by relname`,
      );
      for (const row of rows) {
        // 'f' is REPLICA IDENTITY FULL; the default 'd' sends only the key.
        expect(row.identity, `${row.relname} replica identity`).toBe("f");
      }
    });
  });
});

describe("account management", () => {
  it("lets an admin change someone's role", async () => {
    await withRollback(async (c) => {
      const admin = await seedUser(c, { role: "admin" });
      const b = await seedUser(c);

      await actAs(c, admin.id);
      await c.query("update public.profiles set role = 'admin' where id = $1", [
        b.id,
      ]);

      const { rows } = await c.query<{ role: string }>(
        "select role from public.profiles where id = $1",
        [b.id],
      );
      expect(rows[0]!.role).toBe("admin");
    });
  });

  it("lets an admin deactivate a leaver without touching their history", async () => {
    await withRollback(async (c) => {
      const admin = await seedUser(c, { role: "admin" });
      const leaver = await seedUser(c);
      const insurer = await seedInsurer(c);
      const today = await sgToday(c);

      await seedSubmission(c, leaver.id, today);
      await seedCase(c, leaver.id, insurer, {
        dateSubmitted: "2026-03-10",
        gr: 5000,
      });

      await actAs(c, admin.id);
      await c.query(
        "update public.profiles set active = false where id = $1",
        [leaver.id],
      );

      // Their GR is still there, in the month it was earned.
      const { rows } = await c.query<{ active_gr: string }>(
        `select active_gr from public.v_monthly_consultant_gr
          where consultant_id = $1 and year = 2026 and month = 3`,
        [leaver.id],
      );
      expect(Number(rows[0]!.active_gr)).toBe(5000);

      // But they are no longer chased.
      const missing = await c.query<{ user_id: string }>(
        "select user_id from public.missing_submissions(null)",
      );
      expect(missing.rows.map((r) => r.user_id)).not.toContain(leaver.id);
    });
  });

  it("stops a consultant reading anyone else's profile", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await seedUser(c);
      await seedUser(c, { role: "admin" });

      await actAs(c, a.id);
      const { rows } = await c.query<{ id: string }>(
        "select id from public.profiles",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe(a.id);
    });
  });

  it("lets an admin see everyone, including deactivated accounts", async () => {
    await withRollback(async (c) => {
      const admin = await seedUser(c, { role: "admin" });
      const b = await seedUser(c);
      await asOwner(c);
      await c.query("update public.profiles set active = false where id = $1", [
        b.id,
      ]);

      await actAs(c, admin.id);
      const { rows } = await c.query("select id from public.profiles");
      expect(rows.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("stops a deactivated admin from acting as an admin", async () => {
    await withRollback(async (c) => {
      const admin = await seedUser(c, { role: "admin" });
      const b = await seedUser(c);
      await asOwner(c);
      await c.query("update public.profiles set active = false where id = $1", [
        admin.id,
      ]);

      // is_admin() requires the profile to be active, so a deactivated admin
      // loses their powers rather than keeping them until someone notices.
      await actAs(c, admin.id);
      const { rows } = await c.query("select id from public.profiles");
      expect(rows.map((r) => (r as { id: string }).id)).not.toContain(b.id);
    });
  });
});

describe("the audit trail is readable but not writable", () => {
  it("lets an admin read every entry", async () => {
    await withRollback(async (c) => {
      const admin = await seedUser(c, { role: "admin" });
      const b = await seedUser(c);
      await asOwner(c);
      await c.query(
        `insert into public.audit_logs (actor_user_id, action, entity_type)
         values ($1, 'case_created', 'cases'), ($2, 'target_changed', 'consultant_targets')`,
        [admin.id, b.id],
      );

      await actAs(c, admin.id);
      const { rows } = await c.query("select * from public.audit_logs");
      expect(rows).toHaveLength(2);
    });
  });

  it("shows a consultant only their own entries", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const b = await seedUser(c);
      await asOwner(c);
      await c.query(
        `insert into public.audit_logs (actor_user_id, action, entity_type)
         values ($1, 'case_created', 'cases'), ($2, 'case_created', 'cases')`,
        [a.id, b.id],
      );

      await actAs(c, a.id);
      const { rows } = await c.query<{ actor_user_id: string }>(
        "select actor_user_id from public.audit_logs",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.actor_user_id).toBe(a.id);
    });
  });

  it("stops anyone attributing an action to someone else", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const b = await seedUser(c);

      await actAs(c, a.id);
      await expectRejection(() =>
        c.query(
          `insert into public.audit_logs (actor_user_id, action, entity_type)
           values ($1, 'case_cancelled', 'cases')`,
          [b.id],
        ),
      );
    });
  });
});

describe("a refused write is silent, not an error", () => {
  // Postgres does NOT raise on an UPDATE or DELETE that RLS filters out - the
  // rows simply do not match, and the statement reports success having changed
  // nothing. Any server action that checks only `error` therefore reports
  // "saved" to someone whose change was actually rejected.
  //
  // These tests pin that behaviour so the actions are written against what the
  // database really does rather than what it looks like it should do.

  it("silently changes nothing when RLS filters the row out", async () => {
    await withRollback(async (c) => {
      const owner = await seedUser(c);
      const stranger = await seedUser(c);
      const today = await sgToday(c);

      await asOwner(c);
      const {
        rows: [submission],
      } = await c.query<{ id: string }>(
        `insert into public.daily_submissions
           (user_id, business_date, dials, talked_to, campaign_status, in_office, status)
         values ($1, $2, 5, 2, 'running', true, 'draft')
         returning id`,
        [owner.id, today],
      );
      const {
        rows: [appointment],
      } = await c.query<{ id: string }>(
        `insert into public.appointment_activities
           (daily_submission_id, user_id, business_date, prospect_name, appointment_type)
         values ($1, $2, $3, 'Ahmad', 'opening')
         returning id`,
        [submission!.id, owner.id, today],
      );

      await actAs(c, stranger.id);

      // No throw - this is the whole point.
      const updated = await c.query(
        "update public.appointment_activities set prospect_name = 'Hijacked' where id = $1",
        [appointment!.id],
      );
      expect(updated.rowCount).toBe(0);

      const deleted = await c.query(
        "delete from public.appointment_activities where id = $1",
        [appointment!.id],
      );
      expect(deleted.rowCount).toBe(0);

      await asOwner(c);
      const { rows } = await c.query<{ prospect_name: string }>(
        "select prospect_name from public.appointment_activities where id = $1",
        [appointment!.id],
      );
      expect(rows[0]?.prospect_name).toBe("Ahmad");
    });
  });

  it("returns the changed rows when the write is genuinely allowed", async () => {
    // The fix relies on this: asking for the updated rows back distinguishes
    // "changed nothing" from "changed something".
    await withRollback(async (c) => {
      const owner = await seedUser(c);
      const today = await sgToday(c);

      await asOwner(c);
      const {
        rows: [submission],
      } = await c.query<{ id: string }>(
        `insert into public.daily_submissions
           (user_id, business_date, dials, talked_to, campaign_status, in_office, status)
         values ($1, $2, 5, 2, 'running', true, 'draft')
         returning id`,
        [owner.id, today],
      );
      const {
        rows: [appointment],
      } = await c.query<{ id: string }>(
        `insert into public.appointment_activities
           (daily_submission_id, user_id, business_date, prospect_name, appointment_type)
         values ($1, $2, $3, 'Ahmad', 'opening')
         returning id`,
        [submission!.id, owner.id, today],
      );

      await actAs(c, owner.id);
      const updated = await c.query(
        "update public.appointment_activities set prospect_name = 'Ahmad Bin Ali' where id = $1 returning id",
        [appointment!.id],
      );

      expect(updated.rowCount).toBe(1);
    });
  });
});
