import { describe, it, expect, afterAll } from "vitest";
import {
  pool,
  withRollback,
  actAs,
  asOwner,
  seedUser,
  seedInsurer,
  seedCase,
  expectRejection,
} from "./helpers";

afterAll(async () => {
  await pool.end();
});

type Client = Parameters<Parameters<typeof withRollback>[0]>[0];

async function activeGr(
  c: Client,
  consultantId: string,
  year: number,
  month: number,
): Promise<number> {
  const { rows } = await c.query<{ active_gr: string | null }>(
    `select active_gr from public.v_monthly_consultant_gr
      where consultant_id = $1 and year = $2 and month = $3`,
    [consultantId, year, month],
  );
  return Number(rows[0]?.active_gr ?? 0);
}

describe("GR credits the month a case was submitted (decision D16)", () => {
  it("counts a case in its submitted month, not its inception month", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const insurer = await seedInsurer(c);

      // Submitted in March, incepted in May.
      await seedCase(c, a.id, insurer, {
        dateSubmitted: "2026-03-10",
        dateIncepted: "2026-05-02",
        gr: 4000,
      });

      await actAs(c, a.id);
      expect(await activeGr(c, a.id, 2026, 3)).toBe(4000);
      expect(await activeGr(c, a.id, 2026, 5)).toBe(0);
    });
  });

  it("counts a case with no inception date at all", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const insurer = await seedInsurer(c);
      await seedCase(c, a.id, insurer, {
        dateSubmitted: "2026-03-10",
        dateIncepted: null,
        gr: 2500,
      });

      await actAs(c, a.id);
      expect(await activeGr(c, a.id, 2026, 3)).toBe(2500);
    });
  });

  it("surfaces a case with no inception date as pending", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const insurer = await seedInsurer(c);
      await seedCase(c, a.id, insurer, { dateIncepted: null, gr: 2500 });
      await seedCase(c, a.id, insurer, { dateIncepted: "2026-03-20", gr: 1000 });

      await actAs(c, a.id);
      const { rows } = await c.query<{
        pending_cases: string;
        pending_gr: string;
      }>(
        "select pending_cases, pending_gr from public.v_pending_inception where consultant_id = $1",
        [a.id],
      );
      expect(Number(rows[0]!.pending_cases)).toBe(1);
      expect(Number(rows[0]!.pending_gr)).toBe(2500);
    });
  });

  it("refuses an inception date before the submission date", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const insurer = await seedInsurer(c);
      await expectRejection(() =>
        seedCase(c, a.id, insurer, {
          dateSubmitted: "2026-03-10",
          dateIncepted: "2026-03-01",
        }),
      );
    });
  });
});

describe("cancellation (decisions D6, D15)", () => {
  it("removes a cancelled case from GR while keeping the row", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const insurer = await seedInsurer(c);
      const caseId = await seedCase(c, a.id, insurer, {
        dateSubmitted: "2026-03-10",
        gr: 3000,
      });

      await actAs(c, a.id);
      expect(await activeGr(c, a.id, 2026, 3)).toBe(3000);

      await c.query(
        `update public.cases
            set status = 'cancelled',
                cancellation_reason = 'Client cancelled during free-look',
                cancelled_at = now()
          where id = $1`,
        [caseId],
      );

      expect(await activeGr(c, a.id, 2026, 3)).toBe(0);

      // The row itself is still there, in full.
      const { rows } = await c.query<{
        status: string;
        cancellation_reason: string;
        gr_amount: string;
      }>(
        "select status, cancellation_reason, gr_amount from public.cases where id = $1",
        [caseId],
      );
      expect(rows[0]!.status).toBe("cancelled");
      expect(rows[0]!.cancellation_reason).toMatch(/free-look/);
      expect(Number(rows[0]!.gr_amount)).toBe(3000);
    });
  });

  it("restores the GR when an admin restores the case", async () => {
    await withRollback(async (c) => {
      const admin = await seedUser(c, { role: "admin" });
      const b = await seedUser(c);
      const insurer = await seedInsurer(c);
      const caseId = await seedCase(c, b.id, insurer, {
        dateSubmitted: "2026-03-10",
        gr: 3000,
        status: "active",
      });

      await asOwner(c);
      await c.query(
        `update public.cases
            set status = 'cancelled', cancellation_reason = 'Oops', cancelled_at = now()
          where id = $1`,
        [caseId],
      );

      await actAs(c, admin.id);
      expect(await activeGr(c, b.id, 2026, 3)).toBe(0);

      await c.query(
        `update public.cases
            set status = 'active', cancellation_reason = null, cancelled_at = null
          where id = $1`,
        [caseId],
      );
      expect(await activeGr(c, b.id, 2026, 3)).toBe(3000);
    });
  });

  it("refuses a cancellation with no reason", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const insurer = await seedInsurer(c);
      const caseId = await seedCase(c, a.id, insurer);

      await actAs(c, a.id);
      const err = await expectRejection(() =>
        c.query(
          `update public.cases set status = 'cancelled', cancelled_at = now() where id = $1`,
          [caseId],
        ),
      );
      expect(err.message).toMatch(/cases_cancellation_complete/i);
    });
  });

  it("refuses a cancellation with a blank reason", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const insurer = await seedInsurer(c);
      const caseId = await seedCase(c, a.id, insurer);

      await actAs(c, a.id);
      await expectRejection(() =>
        c.query(
          `update public.cases
              set status = 'cancelled', cancellation_reason = '   ', cancelled_at = now()
            where id = $1`,
          [caseId],
        ),
      );
    });
  });

  it("refuses an active case carrying a cancellation reason", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const insurer = await seedInsurer(c);
      const caseId = await seedCase(c, a.id, insurer);

      await actAs(c, a.id);
      await expectRejection(() =>
        c.query(
          "update public.cases set cancellation_reason = 'stray value' where id = $1",
          [caseId],
        ),
      );
    });
  });
});

describe("an appointment closing is not a case", () => {
  it("leaves GR untouched when a closing appointment is logged", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await actAs(c, a.id);

      const { rows: sub } = await c.query<{ id: string; business_date: string }>(
        `insert into public.daily_submissions
           (user_id, business_date, dials, talked_to, campaign_status, in_office, status)
         values ($1, public.sg_today(), 10, 5, 'running', true, 'submitted')
         returning id, business_date::text as business_date`,
        [a.id],
      );

      await c.query(
        `insert into public.appointment_activities
           (daily_submission_id, user_id, business_date, prospect_name, appointment_type)
         values ($1, $2, $3, 'Almost Signed', 'closing')`,
        [sub[0]!.id, a.id, sub[0]!.business_date],
      );

      const { rows } = await c.query<{
        appointments_closing: string;
        active_gr: string;
        signed_cases: string;
      }>(
        `select appointments_closing, active_gr, signed_cases
           from public.v_daily_consultant_summary where submission_id = $1`,
        [sub[0]!.id],
      );
      expect(Number(rows[0]!.appointments_closing)).toBe(1);
      expect(Number(rows[0]!.active_gr)).toBe(0);
      expect(Number(rows[0]!.signed_cases)).toBe(0);
    });
  });
});

describe("case mix by category (decision D18)", () => {
  it("counts cases and APE per policy type", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const insurer = await seedInsurer(c);

      await seedCase(c, a.id, insurer, { policyType: "Term", ape: 1200, gr: 600, dateSubmitted: "2026-03-05" });
      await seedCase(c, a.id, insurer, { policyType: "Term", ape: 800, gr: 400, dateSubmitted: "2026-03-06" });
      await seedCase(c, a.id, insurer, { policyType: "ILP", ape: 5000, gr: 2500, dateSubmitted: "2026-03-07" });
      // A cancelled case must not appear in the mix at all.
      const cancelled = await seedCase(c, a.id, insurer, { policyType: "GI", ape: 999, gr: 99, dateSubmitted: "2026-03-08" });
      await asOwner(c);
      await c.query(
        `update public.cases set status = 'cancelled',
            cancellation_reason = 'x', cancelled_at = now() where id = $1`,
        [cancelled],
      );

      await actAs(c, a.id);
      const { rows } = await c.query<{
        policy_type: string;
        case_count: string;
        ape: string;
      }>(
        `select policy_type, case_count, ape
           from public.v_case_mix_by_category
          where consultant_id = $1 and year = 2026 and month = 3
          order by policy_type`,
        [a.id],
      );

      expect(rows.map((r) => r.policy_type)).toEqual(["ILP", "Term"]);
      const term = rows.find((r) => r.policy_type === "Term")!;
      expect(Number(term.case_count)).toBe(2);
      expect(Number(term.ape)).toBe(2000);
    });
  });
});

describe("insurers (decision D19)", () => {
  it("lets a consultant add an insurer", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await actAs(c, a.id);

      await c.query("insert into public.insurers (name) values ($1)", [
        "Some New Insurer Bhd",
      ]);
      const { rows } = await c.query(
        "select * from public.insurers where name = $1",
        ["Some New Insurer Bhd"],
      );
      expect(rows).toHaveLength(1);
    });
  });

  it("rejects the same insurer under different capitalisation or spacing", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      await actAs(c, a.id);

      await c.query("insert into public.insurers (name) values ($1)", [
        "Duplicate Test Insurer",
      ]);
      const err = await expectRejection(() =>
        c.query("insert into public.insurers (name) values ($1)", [
          "  duplicate   test   insurer  ",
        ]),
      );
      expect(err.message).toMatch(/duplicate key|unique/i);
    });
  });

  it("stops a consultant renaming or retiring an insurer", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const insurer = await seedInsurer(c, "Renameable Insurer");
      await actAs(c, a.id);

      // The UPDATE policy is admin-only, so for a consultant this matches no
      // rows. Postgres reports that as zero rows affected rather than as an
      // error - the guarantee to assert is that nothing actually changed.
      const res = await c.query(
        "update public.insurers set active = false, name = 'Hijacked' where id = $1",
        [insurer],
      );
      expect(res.rowCount).toBe(0);

      await asOwner(c);
      const { rows } = await c.query<{ name: string; active: boolean }>(
        "select name, active from public.insurers where id = $1",
        [insurer],
      );
      expect(rows[0]!.name).toBe("Renameable Insurer");
      expect(rows[0]!.active).toBe(true);
    });
  });

  it("lets an admin rename an insurer without touching its cases", async () => {
    await withRollback(async (c) => {
      const admin = await seedUser(c, { role: "admin" });
      const b = await seedUser(c);
      const insurer = await seedInsurer(c, "Legacy Insurer Name");
      const caseId = await seedCase(c, b.id, insurer);

      await actAs(c, admin.id);
      await c.query("update public.insurers set name = $2 where id = $1", [
        insurer,
        "Renamed Insurer Group",
      ]);

      const { rows } = await c.query<{ name: string }>(
        `select i.name from public.cases c
           join public.insurers i on i.id = c.insurer_id
          where c.id = $1`,
        [caseId],
      );
      expect(rows[0]!.name).toBe("Renamed Insurer Group");
    });
  });
});

describe("targets and shortfall (decisions D4, D17)", () => {
  async function setYearly(c: Client, adminId: string, consultantId: string, year: number, target: number) {
    await actAs(c, adminId);
    await c.query(
      `insert into public.consultant_targets (consultant_id, period_type, year, gr_target)
       values ($1, 'yearly', $2, $3)`,
      [consultantId, year, target],
    );
  }

  it("derives the monthly target as yearly / 12", async () => {
    await withRollback(async (c) => {
      const admin = await seedUser(c, { role: "admin" });
      const b = await seedUser(c);
      const { rows: yr } = await c.query<{ y: number }>(
        "select extract(year from public.sg_today())::int as y",
      );
      await setYearly(c, admin.id, b.id, yr[0]!.y, 120000);

      await actAs(c, b.id);
      const { rows } = await c.query<{
        monthly_target: string;
        yearly_target: string;
      }>(
        "select monthly_target, yearly_target from public.v_target_shortfall where consultant_id = $1",
        [b.id],
      );
      expect(Number(rows[0]!.yearly_target)).toBe(120000);
      expect(Number(rows[0]!.monthly_target)).toBe(10000);
    });
  });

  it("lets an explicit monthly override win", async () => {
    await withRollback(async (c) => {
      const admin = await seedUser(c, { role: "admin" });
      const b = await seedUser(c);
      const { rows: now } = await c.query<{ y: number; m: number }>(
        `select extract(year from public.sg_today())::int as y,
                extract(month from public.sg_today())::int as m`,
      );
      await setYearly(c, admin.id, b.id, now[0]!.y, 120000);
      await c.query(
        `insert into public.consultant_targets
           (consultant_id, period_type, year, month, gr_target)
         values ($1, 'monthly', $2, $3, 4000)`,
        [b.id, now[0]!.y, now[0]!.m],
      );

      await actAs(c, b.id);
      const { rows } = await c.query<{ monthly_target: string }>(
        "select monthly_target from public.v_target_shortfall where consultant_id = $1",
        [b.id],
      );
      expect(Number(rows[0]!.monthly_target)).toBe(4000);
    });
  });

  it("never reports a negative shortfall when the target is exceeded", async () => {
    await withRollback(async (c) => {
      const admin = await seedUser(c, { role: "admin" });
      const b = await seedUser(c);
      const insurer = await seedInsurer(c);
      const { rows: now } = await c.query<{ y: number }>(
        "select extract(year from public.sg_today())::int as y",
      );
      await setYearly(c, admin.id, b.id, now[0]!.y, 12000);

      await asOwner(c);
      await c.query(
        `insert into public.cases
           (consultant_id, date_submitted, client_name, insurer_id, policy_name,
            policy_type, ape_amount, gr_amount)
         values ($1, public.sg_today(), 'Big Client', $2, 'Big Policy', 'ILP', 50000, 50000)`,
        [b.id, insurer],
      );

      await actAs(c, b.id);
      const { rows } = await c.query<{
        monthly_shortfall: string;
        yearly_shortfall: string;
        yearly_achievement: string;
      }>(
        `select monthly_shortfall, yearly_shortfall, yearly_achievement
           from public.v_target_shortfall where consultant_id = $1`,
        [b.id],
      );
      expect(Number(rows[0]!.monthly_shortfall)).toBe(0);
      expect(Number(rows[0]!.yearly_shortfall)).toBe(0);
      expect(Number(rows[0]!.yearly_achievement)).toBeGreaterThan(1);
    });
  });

  it("reports no target rather than dividing by zero", async () => {
    await withRollback(async (c) => {
      const b = await seedUser(c);
      await actAs(c, b.id);

      const { rows } = await c.query<{
        monthly_target: string | null;
        monthly_achievement: string | null;
        monthly_shortfall: string | null;
      }>(
        `select monthly_target, monthly_achievement, monthly_shortfall
           from public.v_target_shortfall where consultant_id = $1`,
        [b.id],
      );
      expect(rows[0]!.monthly_target).toBeNull();
      expect(rows[0]!.monthly_achievement).toBeNull();
      expect(rows[0]!.monthly_shortfall).toBeNull();
    });
  });

  it("keeps a past month's target when a later year is changed", async () => {
    await withRollback(async (c) => {
      const admin = await seedUser(c, { role: "admin" });
      const b = await seedUser(c);

      await actAs(c, admin.id);
      await c.query(
        `insert into public.consultant_targets (consultant_id, period_type, year, month, gr_target)
         values ($1, 'monthly', 2025, 5, 8000), ($1, 'monthly', 2025, 6, 9000)`,
        [b.id],
      );
      // Raising June must not touch May.
      await c.query(
        `update public.consultant_targets set gr_target = 15000
          where consultant_id = $1 and year = 2025 and month = 6`,
        [b.id],
      );

      const { rows } = await c.query<{ month: number; gr_target: string }>(
        `select month, gr_target from public.consultant_targets
          where consultant_id = $1 and year = 2025 order by month`,
        [b.id],
      );
      expect(Number(rows[0]!.gr_target)).toBe(8000);
      expect(Number(rows[1]!.gr_target)).toBe(15000);
    });
  });
});
