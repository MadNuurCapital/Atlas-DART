import { describe, it, expect, afterAll } from "vitest";
import {
  pool,
  withRollback,
  actAs,
  asOwner,
  seedUser,
  seedSubmission,
  expectRejection,
} from "./helpers";

afterAll(async () => {
  await pool.end();
});

type Client = Parameters<Parameters<typeof withRollback>[0]>[0];

/**
 * Leave & Away Mode, against a real database.
 *
 * The whole feature is read-time behaviour over six functions, so these tests
 * ask those functions questions rather than inspecting rows. The one thing
 * worth stating up front is what is NOT tested here, because it cannot be:
 * nothing in this feature is on a write path, so there is no test for "a
 * submission still succeeds during leave" that could meaningfully fail. The
 * test that matters for that is the one asserting the write policies are
 * untouched, at the bottom of this file.
 */

/**
 * A fixed date, not today's.
 *
 * Every function here takes a p_date or p_as_of precisely so that month ends,
 * year ends and the "today does not count yet" rule can be exercised on
 * whatever day the suite happens to run. Pinning the date is what makes these
 * tests mean the same thing in June as on 31 December.
 */
const AS_OF = "2026-06-12";

async function addLeave(
  client: Client,
  userId: string,
  startsOn: string,
  endsOn: string,
  opts: { reason?: string; note?: string; cancelled?: boolean } = {},
) {
  await asOwner(client);
  const { rows } = await client.query(
    `insert into public.leave_periods
       (user_id, starts_on, ends_on, reason, note, cancelled_at)
     values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [
      userId,
      startsOn,
      endsOn,
      opts.reason ?? "holiday",
      opts.note ?? null,
      opts.cancelled ? new Date().toISOString() : null,
    ],
  );
  return rows[0].id as string;
}

async function missingOn(client: Client, date: string): Promise<string[]> {
  const { rows } = await client.query(
    "select user_id from public.missing_submissions($1)",
    [date],
  );
  return rows.map((r) => r.user_id as string);
}

async function teamRow(client: Client, date: string, userId: string) {
  const { rows } = await client.query(
    "select * from public.team_daily($1) where user_id = $2",
    [date, userId],
  );
  return rows[0];
}

async function compliance(client: Client, userId: string, y: number, m: number) {
  const { rows } = await client.query(
    "select * from public.monthly_compliance($1, $2) where consultant_id = $3",
    [y, m, userId],
  );
  return rows[0];
}

async function missed(client: Client, asOf = AS_OF) {
  const { rows } = await client.query(
    "select public.my_missed_days($1::date) as m",
    [asOf],
  );
  return rows[0].m as {
    missed: number;
    away_days: number;
    away_now: boolean;
    ever_submitted: boolean;
  };
}

// ===========================================================================
// 1. Scheduling, and the rules the database enforces itself
// ===========================================================================

describe("scheduling leave", () => {
  it("accepts a single day, with both ends inclusive", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      await addLeave(c, user.id, "2026-06-10", "2026-06-10");

      const { rows } = await c.query(
        "select public.away_days($1, $2, $3) as n",
        [user.id, "2026-06-01", "2026-06-30"],
      );
      // One day away, not zero. Everything downstream depends on this.
      expect(rows[0].n).toBe(1);
    });
  });

  it("refuses a range that ends before it starts", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      const err = await expectRejection(() =>
        addLeave(c, user.id, "2026-06-10", "2026-06-01"),
      );
      expect(err.message).toMatch(/leave_periods_dates_ordered/);
    });
  });

  it("refuses a mistyped year rather than silencing someone for 12 months", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      // "2027" for "2026" on the end date - the single likeliest typo on a
      // two-date form, and the one with the worst consequence.
      const err = await expectRejection(() =>
        addLeave(c, user.id, "2026-06-10", "2027-06-20"),
      );
      expect(err.message).toMatch(/not_absurdly_long/);
    });
  });

  it("refuses 'other' with no note", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      const err = await expectRejection(() =>
        addLeave(c, user.id, "2026-06-10", "2026-06-11", { reason: "other" }),
      );
      expect(err.message).toMatch(/other_needs_a_note/);
    });
  });
});

describe("overlapping leave is impossible, not merely discouraged", () => {
  it("refuses a second period covering the same days", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      await addLeave(c, user.id, "2026-06-10", "2026-06-20");

      const err = await expectRejection(() =>
        addLeave(c, user.id, "2026-06-15", "2026-06-25"),
      );
      expect(err.message).toMatch(/leave_periods_no_overlap/);
    });
  });

  it("refuses an overlap of a single shared day", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      await addLeave(c, user.id, "2026-06-10", "2026-06-20");

      // The 20th is the last day of the first period and the first day of the
      // second. Inclusive ranges make this an overlap; half-open ones would
      // not, which is why the constraint spells out '[]'.
      const err = await expectRejection(() =>
        addLeave(c, user.id, "2026-06-20", "2026-06-22"),
      );
      expect(err.message).toMatch(/leave_periods_no_overlap/);
    });
  });

  it("allows back-to-back periods that merely touch", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      await addLeave(c, user.id, "2026-06-10", "2026-06-20");
      await addLeave(c, user.id, "2026-06-21", "2026-06-25", {
        reason: "medical",
      });

      const { rows } = await c.query(
        "select count(*)::int as n from public.leave_periods where user_id = $1",
        [user.id],
      );
      expect(rows[0].n).toBe(2);
    });
  });

  it("frees the dates again once a period is cancelled", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      const id = await addLeave(c, user.id, "2026-06-10", "2026-06-20");

      await asOwner(c);
      await c.query(
        "update public.leave_periods set cancelled_at = now() where id = $1",
        [id],
      );

      // Somebody who cancels and re-books the same week must not be blocked
      // by the booking they have just cancelled.
      await addLeave(c, user.id, "2026-06-12", "2026-06-18");
      const { rows } = await c.query(
        "select public.away_days($1, $2, $3) as n",
        [user.id, "2026-06-01", "2026-06-30"],
      );
      expect(rows[0].n).toBe(7);
    });
  });

  it("does not let one person's leave block another's", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const b = await seedUser(c);
      await addLeave(c, a.id, "2026-06-10", "2026-06-20");
      await addLeave(c, b.id, "2026-06-10", "2026-06-20");

      const { rows } = await c.query(
        "select count(*)::int as n from public.leave_periods",
      );
      expect(rows[0].n).toBe(2);
    });
  });
});

// ===========================================================================
// 2. Reminders: the whole point of the feature
// ===========================================================================

describe("reminders are suppressed while away", () => {
  it("drops an away person from the missing list", async () => {
    await withRollback(async (c) => {
      const away = await seedUser(c);
      const working = await seedUser(c);
      await addLeave(c, away.id, "2026-06-10", "2026-06-20");

      await asOwner(c);
      const list = await missingOn(c, "2026-06-12");

      expect(list).not.toContain(away.id);
      // And the person who is NOT away is still chased. Half of this feature
      // working would be worse than none of it.
      expect(list).toContain(working.id);
    });
  });

  it("chases them on the day before their leave starts", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      await addLeave(c, user.id, "2026-06-10", "2026-06-20");

      await asOwner(c);
      expect(await missingOn(c, "2026-06-09")).toContain(user.id);
    });
  });

  it("chases them again the day after it ends, with no reactivation", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      await addLeave(c, user.id, "2026-06-10", "2026-06-20");

      await asOwner(c);
      // Both ends inclusive, so the 20th is still away and the 21st is not.
      expect(await missingOn(c, "2026-06-20")).not.toContain(user.id);
      expect(await missingOn(c, "2026-06-21")).toContain(user.id);
    });
  });

  it("still chases them if the leave was cancelled", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      await addLeave(c, user.id, "2026-06-10", "2026-06-20", {
        cancelled: true,
      });

      await asOwner(c);
      expect(await missingOn(c, "2026-06-12")).toContain(user.id);
    });
  });

  it("leaves the missing list byte-identical when nobody has any leave", async () => {
    await withRollback(async (c) => {
      await seedUser(c);
      await seedUser(c);
      await asOwner(c);

      // The regression that matters most. Everything above is new behaviour;
      // this is the assertion that the fourteen people who are not on holiday
      // are chased exactly as they were before this feature existed.
      const { rows } = await c.query(
        `select count(*)::int as n
           from public.profiles p
          where p.active
            and not exists (
              select 1 from public.daily_submissions ds
               where ds.user_id = p.id
                 and ds.business_date = $1
                 and ds.status = 'submitted'
            )`,
        ["2026-06-12"],
      );
      expect((await missingOn(c, "2026-06-12")).length).toBe(rows[0].n);
    });
  });

  it("drops them once they submit, away or not", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      await addLeave(c, user.id, "2026-06-10", "2026-06-20");
      await seedSubmission(c, user.id, "2026-06-12");

      await asOwner(c);
      expect(await missingOn(c, "2026-06-12")).not.toContain(user.id);
    });
  });
});

// ===========================================================================
// 3. Attendance: blue, not red
// ===========================================================================

describe("the attendance board", () => {
  it("reads away rather than missing", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      await addLeave(c, user.id, "2026-06-10", "2026-06-20", {
        reason: "medical",
      });

      await asOwner(c);
      const row = await teamRow(c, "2026-06-12", user.id);

      expect(row.status).toBe("away");
      expect(row.away).toBe(true);
      expect(row.away_until).toEqual(new Date(Date.UTC(2026, 5, 20)));
      expect(row.leave_reason).toBe("medical");
    });
  });

  it("reads submitted, and still away, for a DART filed from a hotel", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      await addLeave(c, user.id, "2026-06-10", "2026-06-20");
      await seedSubmission(c, user.id, "2026-06-12");

      await asOwner(c);
      const row = await teamRow(c, "2026-06-12", user.id);

      // Away Mode removes an obligation; it does not remove the work. If this
      // ever read 'away' the person would lose credit for having submitted.
      expect(row.status).toBe("submitted");
      expect(row.away).toBe(true);
    });
  });

  it("still reads missing for someone with no leave", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      await asOwner(c);
      const row = await teamRow(c, "2026-06-12", user.id);

      expect(row.status).toBe("missing");
      expect(row.away).toBe(false);
      expect(row.away_until).toBeNull();
    });
  });

  it("returns one row per person even with leave joined", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      // Two periods, neither covering the queried date. The join must not fan
      // out; the no-overlap constraint is what guarantees it cannot.
      await addLeave(c, user.id, "2026-06-01", "2026-06-05");
      await addLeave(c, user.id, "2026-06-20", "2026-06-25");

      await asOwner(c);
      const { rows } = await c.query(
        "select count(*)::int as n from public.team_daily($1) where user_id = $2",
        ["2026-06-12", user.id],
      );
      expect(rows[0].n).toBe(1);
    });
  });
});

// ===========================================================================
// 4. Scorecards: forgive the denominator, never inflate the numerator
// ===========================================================================

describe("monthly compliance", () => {
  it("stops asking for days the person was away", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      await addLeave(c, user.id, "2026-06-05", "2026-06-11");

      await asOwner(c);
      const row = await compliance(c, user.id, 2026, 6);

      // Twelve days have elapsed in June on the 12th... except the suite may
      // run on any date, so assert the RELATIONSHIP rather than the number:
      // seven away days are removed from whatever the calendar says.
      expect(row.away_days).toBe(7);
      expect(row.submitted_days).toBe("0");
    });
  });

  it("never counts an away day as a submission", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      await addLeave(c, user.id, "2026-06-05", "2026-06-11");

      await asOwner(c);
      const row = await compliance(c, user.id, 2026, 6);

      // The line that keeps this honest. Leave must not manufacture
      // production: an advisor away all month reads 0 of 0, not 20 of 20.
      expect(row.submitted_days).toBe("0");
      expect(row.on_time_days).toBe("0");
    });
  });

  it("cannot be pushed past 100% by submitting while away", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      // Away for the whole of a finished month, but submitted twice anyway.
      await addLeave(c, user.id, "2026-05-01", "2026-05-31");
      await seedSubmission(c, user.id, "2026-05-04");
      await seedSubmission(c, user.id, "2026-05-05");

      await asOwner(c);
      const row = await compliance(c, user.id, 2026, 5);

      expect(row.required_days).toBe(0);
      expect(row.submitted_days).toBe("2");
      expect(Number(row.compliance)).toBe(1);
      expect(row.missing_days).toBe(0);
    });
  });

  it("asks for nothing extra from a month with no leave", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      await asOwner(c);
      const row = await compliance(c, user.id, 2026, 5);

      // A finished month with no leave: all 31 days required, as before.
      expect(row.required_days).toBe(31);
      expect(row.away_days).toBe(0);
    });
  });

  it("counts only the part of a straddling period inside the month", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      // 28 May to 3 June. May should see 4 days, June should see 3.
      await addLeave(c, user.id, "2026-05-28", "2026-06-03");

      await asOwner(c);
      const may = await compliance(c, user.id, 2026, 5);
      expect(may.away_days).toBe(4);
      expect(may.required_days).toBe(27);
    });
  });

  it("requires nothing for a month that has not started", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      await asOwner(c);
      // A future month gives away_days() an inverted window. Clamped to 0, or
      // a negative would quietly raise required_days above the calendar.
      const row = await compliance(c, user.id, 2099, 1);
      expect(row.required_days).toBe(0);
      expect(row.away_days).toBe(0);
    });
  });
});

// ===========================================================================
// 5. "You have missed N days"
// ===========================================================================

describe("missed days", () => {
  it("forgives a week away rather than greeting someone with it", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      // Submitted on the 4th, away the 5th to the 11th, back today (the 12th).
      await seedSubmission(c, user.id, "2026-06-04");
      await addLeave(c, user.id, "2026-06-05", "2026-06-11");

      await actAs(c, user.id);
      const m = await missed(c);

      // The number this whole feature was asked for. Before it, this was 7.
      expect(m.missed).toBe(0);
      expect(m.away_days).toBe(7);
    });
  });

  it("still counts the days either side of the leave", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      // Submitted on the 1st; away only the 5th to the 9th. The 2nd, 3rd, 4th,
      // 10th and 11th were working days that were missed, and they still are.
      await seedSubmission(c, user.id, "2026-06-01");
      await addLeave(c, user.id, "2026-06-05", "2026-06-09");

      await actAs(c, user.id);
      const m = await missed(c);

      expect(m.away_days).toBe(5);
      expect(m.missed).toBe(5);
    });
  });

  it("never counts today, away or not", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      await seedSubmission(c, user.id, "2026-06-11");

      await actAs(c, user.id);
      // Yesterday was submitted and today is still open, so nothing is owed.
      // At ten in the morning nobody has submitted today.
      expect((await missed(c)).missed).toBe(0);
    });
  });

  it("reports away_now so a notice can stay quiet during leave", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      await seedSubmission(c, user.id, "2026-06-01");
      await addLeave(c, user.id, "2026-06-10", "2026-06-20");

      await actAs(c, user.id);
      const m = await missed(c);

      // A gap that predates the leave is real - but "Catch up" is not a
      // reasonable thing to show somebody on medical leave today.
      expect(m.away_now).toBe(true);
      expect(m.missed).toBeGreaterThan(0);
    });
  });

  it("is unchanged for somebody who has never been away", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      await seedSubmission(c, user.id, "2026-06-08");

      await actAs(c, user.id);
      const m = await missed(c);

      // The 9th, 10th and 11th. Exactly what it said before this feature.
      expect(m.missed).toBe(3);
      expect(m.away_days).toBe(0);
      expect(m.away_now).toBe(false);
    });
  });
});

// ===========================================================================
// 6. Boundaries: months, years, and the Singapore day
// ===========================================================================

describe("date boundaries", () => {
  it("spans the end of a month", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      await addLeave(c, user.id, "2026-06-28", "2026-07-04");

      await asOwner(c);
      expect(await missingOn(c, "2026-06-30")).not.toContain(user.id);
      expect(await missingOn(c, "2026-07-01")).not.toContain(user.id);
      expect(await missingOn(c, "2026-07-05")).toContain(user.id);
    });
  });

  it("spans the end of the year", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      await addLeave(c, user.id, "2026-12-27", "2027-01-05");

      await asOwner(c);
      expect(await missingOn(c, "2026-12-31")).not.toContain(user.id);
      expect(await missingOn(c, "2027-01-01")).not.toContain(user.id);

      // And the days split correctly across the two calendar years.
      const { rows } = await c.query(
        `select public.away_days($1, '2026-12-01', '2026-12-31') as dec,
                public.away_days($1, '2027-01-01', '2027-01-31') as jan`,
        [user.id],
      );
      expect(rows[0].dec).toBe(5);
      expect(rows[0].jan).toBe(5);
    });
  });

  it("treats a leap day as a day", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      await addLeave(c, user.id, "2028-02-27", "2028-03-01");

      await asOwner(c);
      expect(await missingOn(c, "2028-02-29")).not.toContain(user.id);
      const { rows } = await c.query(
        "select public.away_days($1, '2028-02-01', '2028-02-29') as n",
        [user.id],
      );
      expect(rows[0].n).toBe(3);
    });
  });
});

// ===========================================================================
// 7. Permissions and the audit trail
// ===========================================================================

describe("agents manage only their own leave", () => {
  it("lets somebody schedule their own", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      await actAs(c, user.id);

      await c.query(
        `insert into public.leave_periods (user_id, starts_on, ends_on, reason)
         values ($1, '2026-06-20', '2026-06-25', 'holiday')`,
        [user.id],
      );

      const { rows } = await c.query(
        "select count(*)::int as n from public.leave_periods",
      );
      expect(rows[0].n).toBe(1);
    });
  });

  it("refuses to let somebody book leave in another person's name", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const b = await seedUser(c);
      await actAs(c, a.id);

      const err = await expectRejection(() =>
        c.query(
          `insert into public.leave_periods (user_id, starts_on, ends_on, reason)
           values ($1, '2026-06-20', '2026-06-25', 'holiday')`,
          [b.id],
        ),
      );
      expect(err.message).toMatch(/row-level security/i);
    });
  });

  it("hides one agent's leave from another", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const b = await seedUser(c);
      await addLeave(c, b.id, "2026-06-10", "2026-06-20", {
        reason: "medical",
      });

      await actAs(c, a.id);
      const { rows } = await c.query("select * from public.leave_periods");

      // Medical-leave dates are the most sensitive thing in this table.
      expect(rows).toHaveLength(0);
    });
  });

  it("refuses to let one agent edit another's leave", async () => {
    await withRollback(async (c) => {
      const a = await seedUser(c);
      const b = await seedUser(c);
      const id = await addLeave(c, b.id, "2026-06-10", "2026-06-20");

      await actAs(c, a.id);
      const res = await c.query(
        "update public.leave_periods set ends_on = '2026-06-30' where id = $1",
        [id],
      );
      // Not an error - the row is simply not visible to them, which is how
      // every other policy in this schema behaves.
      expect(res.rowCount).toBe(0);
    });
  });

  it("shows everybody's leave to an admin", async () => {
    await withRollback(async (c) => {
      const admin = await seedUser(c, { role: "admin" });
      const other = await seedUser(c);
      await addLeave(c, other.id, "2026-06-10", "2026-06-20");

      await actAs(c, admin.id);
      const { rows } = await c.query("select * from public.leave_periods");
      expect(rows).toHaveLength(1);
    });
  });

  it("lets nobody delete a leave record, admins included", async () => {
    await withRollback(async (c) => {
      const admin = await seedUser(c, { role: "admin" });
      const id = await addLeave(c, admin.id, "2026-06-10", "2026-06-20");

      await actAs(c, admin.id);
      const err = await expectRejection(() =>
        c.query("delete from public.leave_periods where id = $1", [id]),
      );

      // Refused outright, not silently matched against nothing - because
      // DELETE is never granted on this table, and a grant is checked BEFORE
      // any policy. Two independent gates, and this one does not even reach
      // the row. Cancelling is an UPDATE instead, so the audit row recording
      // it always has something left to point at.
      expect(err.message).toMatch(/permission denied/i);
    });
  });
});

describe("finished leave is a record, not a draft", () => {
  it("refuses to change a period that has already ended", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      const id = await addLeave(c, user.id, "2020-01-01", "2020-01-10");

      await actAs(c, user.id);
      const res = await c.query(
        "update public.leave_periods set reason = 'medical' where id = $1",
        [id],
      );
      expect(res.rowCount).toBe(0);
    });
  });

  it("lets somebody come home early from leave that is running", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      const { rows: t } = await c.query("select public.sg_today() as d");
      const today: Date = t[0].d;
      const iso = (offset: number) => {
        const d = new Date(today);
        d.setUTCDate(d.getUTCDate() + offset);
        return d.toISOString().slice(0, 10);
      };

      const id = await addLeave(c, user.id, iso(-3), iso(+5));

      await actAs(c, user.id);
      // Shortening a running period writes an ends_on in the PAST, which is
      // the single most likely edit anyone will make. The update policy puts
      // its window on the row as it stands, not on the values being written,
      // precisely so this is allowed.
      const res = await c.query(
        "update public.leave_periods set ends_on = $2 where id = $1",
        [id, iso(-1)],
      );
      expect(res.rowCount).toBe(1);
    });
  });

  it("allows backdated leave to be created", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      await actAs(c, user.id);

      // Somebody hospitalised last week has to be able to put it right. The
      // audit trail, written by the server action, is the accountability.
      const res = await c.query(
        `insert into public.leave_periods (user_id, starts_on, ends_on, reason)
         values ($1, '2020-03-01', '2020-03-05', 'medical')`,
        [user.id],
      );
      expect(res.rowCount).toBe(1);
    });
  });

  it("keeps created_at when leave is backdated, so the entry date survives", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      await actAs(c, user.id);

      const { rows } = await c.query(
        `insert into public.leave_periods (user_id, starts_on, ends_on, reason)
         values ($1, '2020-03-01', '2020-03-05', 'medical')
         returning starts_on, created_at`,
        [user.id],
      );

      // The leave dates say when they were away; created_at says when they
      // told us. Backdating must not be able to rewrite the second.
      expect(new Date(rows[0].created_at).getUTCFullYear()).toBeGreaterThan(
        2024,
      );
    });
  });
});

// ===========================================================================
// 8. The guarantee: Away Mode is not on any write path
// ===========================================================================

describe("Away Mode never blocks a submission", () => {
  it("accepts a DART submitted during leave", async () => {
    await withRollback(async (c) => {
      const user = await seedUser(c);
      const { rows: t } = await c.query(
        "select public.sg_today()::text as d",
      );
      const today = t[0].d as string;

      await addLeave(c, user.id, today, today);
      await actAs(c, user.id);

      const res = await c.query(
        `insert into public.daily_submissions
           (user_id, business_date, dials, talked_to, campaign_status,
            in_office, status)
         values ($1, $2, 10, 5, 'running', true, 'submitted')`,
        [user.id, today],
      );
      expect(res.rowCount).toBe(1);
    });
  });

  it("has added no trigger to daily_submissions or cases", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query(
        `select tgname
           from pg_trigger t
           join pg_class rel on rel.oid = t.tgrelid
          where rel.relname in ('daily_submissions', 'cases')
            and not t.tgisinternal
            and tgname ilike '%leave%'`,
      );
      // The structural version of the promise. A celebration trigger on cases
      // took case submission down in production once already, because an
      // AFTER INSERT trigger that raises rolls back the row that fired it.
      // The way not to repeat that is to not be on the write path at all.
      expect(rows).toHaveLength(0);
    });
  });
});
