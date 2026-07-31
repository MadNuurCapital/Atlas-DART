import { describe, it, expect, afterAll } from "vitest";
import {
  pool,
  withRollback,
  actAs,
  asOwner,
  seedUser,
  expectRejection,
} from "./helpers";
import type { PoolClient } from "pg";

afterAll(async () => {
  await pool.end();
});

type Client = PoolClient;

/**
 * Insert a session directly, bypassing RLS, for test setup.
 *
 * Written as a helper because almost every test needs one and the interesting
 * part is always what happens afterwards, not the insert.
 */
async function seedSession(
  c: Client,
  opts: {
    consultantId: string;
    createdBy: string;
    coachId?: string | null;
    status?: string;
    /** Required, not defaulted - a default here would have to be SQL, not a value. */
    scheduledAt: string | null;
    cancelledAt?: string | null;
    reason?: string | null;
    completedAt?: string | null;
    title?: string;
    category?: string;
  },
): Promise<string> {
  await asOwner(c);
  const {
    rows: [row],
  } = await c.query<{ id: string }>(
    `insert into public.coaching_sessions
       (consultant_id, created_by, coach_id, title, category, status,
        scheduled_at, cancelled_at, cancellation_reason, completed_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     returning id`,
    [
      opts.consultantId,
      opts.createdBy,
      opts.coachId ?? null,
      opts.title ?? "Monthly review",
      opts.category ?? "monthly_review",
      opts.status ?? "scheduled",
      opts.scheduledAt,
      opts.cancelledAt ?? null,
      opts.reason ?? null,
      opts.completedAt ?? null,
    ],
  );
  return row!.id;
}

/** The same, but with scheduled_at expressed relative to now in SQL. */
async function seedScheduled(
  c: Client,
  consultantId: string,
  createdBy: string,
  interval = "2 days",
): Promise<string> {
  await asOwner(c);
  const {
    rows: [row],
  } = await c.query<{ id: string }>(
    `insert into public.coaching_sessions
       (consultant_id, created_by, title, category, status, scheduled_at)
     values ($1, $2, 'Monthly review', 'monthly_review', 'scheduled',
             now() + $3::interval)
     returning id`,
    [consultantId, createdBy, interval],
  );
  return row!.id;
}

describe("a consultant sees only their own coaching", () => {
  it("shows them their own upcoming session", async () => {
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      const admin = await seedUser(c, { role: "admin" });
      await seedScheduled(c, consultant.id, admin.id);

      await actAs(c, consultant.id);
      const { rows } = await c.query("select * from public.coaching_sessions");
      expect(rows).toHaveLength(1);
    });
  });

  it("hides another consultant's session completely", async () => {
    // The whole point of the feature. A direct query with their own token, not
    // a page that forgot a filter.
    await withRollback(async (c) => {
      const owner = await seedUser(c);
      const stranger = await seedUser(c);
      const admin = await seedUser(c, { role: "admin" });
      await seedScheduled(c, owner.id, admin.id);

      await actAs(c, stranger.id);
      const { rows } = await c.query("select * from public.coaching_sessions");
      expect(rows).toHaveLength(0);
    });
  });

  it("hides their own completed history", async () => {
    // Decided during discovery: coaching history belongs to management.
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      const admin = await seedUser(c, { role: "admin" });
      await seedSession(c, {
        consultantId: consultant.id,
        createdBy: admin.id,
        status: "completed",
        scheduledAt: "2026-03-01T06:00:00Z",
        completedAt: "2026-03-01T08:00:00Z",
      });

      await actAs(c, consultant.id);
      const { rows } = await c.query("select * from public.coaching_sessions");
      expect(rows).toHaveLength(0);
    });
  });

  it("hides a session they were marked as having missed", async () => {
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      const admin = await seedUser(c, { role: "admin" });
      await seedSession(c, {
        consultantId: consultant.id,
        createdBy: admin.id,
        status: "missed",
        scheduledAt: "2026-03-01T06:00:00Z",
      });

      await actAs(c, consultant.id);
      const { rows } = await c.query("select * from public.coaching_sessions");
      expect(rows).toHaveLength(0);
    });
  });

  it("shows them their own pending request", async () => {
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      await seedSession(c, {
        consultantId: consultant.id,
        createdBy: consultant.id,
        status: "requested",
        scheduledAt: null,
      });

      await actAs(c, consultant.id);
      const { rows } = await c.query("select * from public.coaching_sessions");
      expect(rows).toHaveLength(1);
    });
  });

  it("removes a cancelled session from their view immediately", async () => {
    // They have already had a notification. A card they can do nothing about
    // is clutter, so it goes the moment it is cancelled - not after a week.
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      const admin = await seedUser(c, { role: "admin" });
      await asOwner(c);
      await c.query(
        `insert into public.coaching_sessions
           (consultant_id, created_by, title, category, status, scheduled_at,
            cancelled_at, cancellation_reason)
         values ($1, $2, 'Monthly review', 'monthly_review', 'cancelled',
                 now() + interval '1 day', now(), 'Clash')`,
        [consultant.id, admin.id],
      );

      await actAs(c, consultant.id);
      const { rows } = await c.query("select * from public.coaching_sessions");
      expect(rows).toHaveLength(0);
    });
  });

  it("still shows a recently declined request, with its reason", async () => {
    // Different case: they ASKED for this, and an answer arriving as silence
    // reads as having been ignored.
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      await asOwner(c);
      await c.query(
        `insert into public.coaching_sessions
           (consultant_id, created_by, title, category, status,
            cancelled_at, cancellation_reason)
         values ($1, $1, 'Coaching request', 'ad_hoc', 'declined',
                 now() - interval '1 day', 'Covered last week')`,
        [consultant.id],
      );

      await actAs(c, consultant.id);
      const { rows } = await c.query<{ cancellation_reason: string }>(
        "select cancellation_reason from public.coaching_sessions",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.cancellation_reason).toBe("Covered last week");
    });
  });

  it("stops showing a declined request after a week", async () => {
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      await asOwner(c);
      await c.query(
        `insert into public.coaching_sessions
           (consultant_id, created_by, title, category, status,
            cancelled_at, cancellation_reason)
         values ($1, $1, 'Coaching request', 'ad_hoc', 'declined',
                 now() - interval '8 days', 'Covered last week')`,
        [consultant.id],
      );

      await actAs(c, consultant.id);
      const { rows } = await c.query("select * from public.coaching_sessions");
      expect(rows).toHaveLength(0);
    });
  });

  it("keeps a cancelled session in full for admins", async () => {
    // Hidden from the consultant, never deleted. The record and its reason
    // stay for management and for the export.
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      const admin = await seedUser(c, { role: "admin" });
      await asOwner(c);
      await c.query(
        `insert into public.coaching_sessions
           (consultant_id, created_by, title, category, status, scheduled_at,
            cancelled_at, cancellation_reason)
         values ($1, $2, 'Monthly review', 'monthly_review', 'cancelled',
                 now() + interval '1 day', now(), 'Clash')`,
        [consultant.id, admin.id],
      );

      await actAs(c, admin.id);
      const { rows } = await c.query<{ cancellation_reason: string }>(
        "select cancellation_reason from public.coaching_sessions",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.cancellation_reason).toBe("Clash");
    });
  });

  it("lets an admin see everything, including another admin's bookings", async () => {
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      const adminOne = await seedUser(c, { role: "admin" });
      const adminTwo = await seedUser(c, { role: "admin" });

      await seedScheduled(c, consultant.id, adminOne.id);
      await seedSession(c, {
        consultantId: consultant.id,
        createdBy: adminOne.id,
        status: "completed",
        scheduledAt: "2026-03-01T06:00:00Z",
        completedAt: "2026-03-01T08:00:00Z",
      });

      await actAs(c, adminTwo.id);
      const { rows } = await c.query("select * from public.coaching_sessions");
      expect(rows).toHaveLength(2);
    });
  });
});

describe("coaching notes never reach the person being coached", () => {
  it("returns nothing to the consultant the notes are about", async () => {
    // Not a filtered column - no rows at all. This is why the notes live in
    // their own table rather than as two more columns on the session.
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      const admin = await seedUser(c, { role: "admin" });
      const sessionId = await seedScheduled(c, consultant.id, admin.id);

      await asOwner(c);
      await c.query(
        `insert into public.coaching_notes (session_id, internal_notes, outcome_notes)
         values ($1, 'Not pulling their weight', 'Agreed to lift dials to 30')`,
        [sessionId],
      );

      await actAs(c, consultant.id);
      const { rows } = await c.query("select * from public.coaching_notes");
      expect(rows).toHaveLength(0);
    });
  });

  it("lets an admin read them", async () => {
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      const admin = await seedUser(c, { role: "admin" });
      const sessionId = await seedScheduled(c, consultant.id, admin.id);

      await asOwner(c);
      await c.query(
        `insert into public.coaching_notes (session_id, internal_notes)
         values ($1, 'Discuss pipeline')`,
        [sessionId],
      );

      await actAs(c, admin.id);
      const { rows } = await c.query<{ internal_notes: string }>(
        "select internal_notes from public.coaching_notes",
      );
      expect(rows[0]?.internal_notes).toBe("Discuss pipeline");
    });
  });

  it("stops a consultant writing notes on their own session", async () => {
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      const admin = await seedUser(c, { role: "admin" });
      const sessionId = await seedScheduled(c, consultant.id, admin.id);

      await actAs(c, consultant.id);
      await expectRejection(() =>
        c.query(
          "insert into public.coaching_notes (session_id, internal_notes) values ($1, 'I am great')",
          [sessionId],
        ),
      );
    });
  });
});

describe("requesting coaching", () => {
  it("lets a consultant ask for themselves", async () => {
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      await actAs(c, consultant.id);

      await c.query(
        `insert into public.coaching_sessions
           (consultant_id, created_by, title, category, status, requested_topic)
         values ($1, $1, 'Help with closing', 'ad_hoc', 'requested',
                 'Struggling to close CIS cases')`,
        [consultant.id],
      );

      const { rows } = await c.query("select * from public.coaching_sessions");
      expect(rows).toHaveLength(1);
    });
  });

  it("stops them requesting on someone else's behalf", async () => {
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      const other = await seedUser(c);
      await actAs(c, consultant.id);

      await expectRejection(() =>
        c.query(
          `insert into public.coaching_sessions
             (consultant_id, created_by, title, category, status)
           values ($1, $2, 'Coaching', 'ad_hoc', 'requested')`,
          [other.id, consultant.id],
        ),
      );
    });
  });

  it("stops them booking themselves a real session", async () => {
    // Scheduling is management's, not theirs. A request carries no time.
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      await actAs(c, consultant.id);

      await expectRejection(() =>
        c.query(
          `insert into public.coaching_sessions
             (consultant_id, created_by, title, category, status, scheduled_at)
           values ($1, $1, 'Coaching', 'ad_hoc', 'scheduled', now() + interval '1 day')`,
          [consultant.id],
        ),
      );
    });
  });

  it("stops them attaching a time to a request", async () => {
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      await actAs(c, consultant.id);

      await expectRejection(() =>
        c.query(
          `insert into public.coaching_sessions
             (consultant_id, created_by, title, category, status, scheduled_at)
           values ($1, $1, 'Coaching', 'ad_hoc', 'requested', now() + interval '1 day')`,
          [consultant.id],
        ),
      );
    });
  });
});

describe("a consultant may acknowledge, and nothing else", () => {
  it("lets them acknowledge their own session", async () => {
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      const admin = await seedUser(c, { role: "admin" });
      const id = await seedScheduled(c, consultant.id, admin.id);

      await actAs(c, consultant.id);
      await c.query(
        "update public.coaching_sessions set acknowledged_at = now() where id = $1",
        [id],
      );

      const { rows } = await c.query<{ acknowledged_at: Date | null }>(
        "select acknowledged_at from public.coaching_sessions where id = $1",
        [id],
      );
      expect(rows[0]?.acknowledged_at).not.toBeNull();
    });
  });

  it("stops them moving the date", async () => {
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      const admin = await seedUser(c, { role: "admin" });
      const id = await seedScheduled(c, consultant.id, admin.id);

      await actAs(c, consultant.id);
      await expectRejection(() =>
        c.query(
          "update public.coaching_sessions set scheduled_at = now() + interval '9 days' where id = $1",
          [id],
        ),
      );
    });
  });

  it("stops them marking their own session completed", async () => {
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      const admin = await seedUser(c, { role: "admin" });
      const id = await seedScheduled(c, consultant.id, admin.id);

      await actAs(c, consultant.id);
      await expectRejection(() =>
        c.query(
          "update public.coaching_sessions set status = 'completed', completed_at = now() where id = $1",
          [id],
        ),
      );
    });
  });

  it("stops them acknowledging somebody else's session", async () => {
    await withRollback(async (c) => {
      const owner = await seedUser(c);
      const stranger = await seedUser(c);
      const admin = await seedUser(c, { role: "admin" });
      const id = await seedScheduled(c, owner.id, admin.id);

      await actAs(c, stranger.id);
      const result = await c.query(
        "update public.coaching_sessions set acknowledged_at = now() where id = $1",
        [id],
      );
      // Filtered out rather than refused - so the row count is the proof.
      expect(result.rowCount).toBe(0);
    });
  });
});

describe("rescheduling clears the acknowledgement", () => {
  it("wipes it when the time moves", async () => {
    // They confirmed a meeting that no longer exists. Leaving the tick would
    // tell an admin they had seen a change they have never been shown.
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      const admin = await seedUser(c, { role: "admin" });
      const id = await seedScheduled(c, consultant.id, admin.id);

      await asOwner(c);
      await c.query(
        "update public.coaching_sessions set acknowledged_at = now() where id = $1",
        [id],
      );

      await actAs(c, admin.id);
      await c.query(
        "update public.coaching_sessions set scheduled_at = now() + interval '5 days' where id = $1",
        [id],
      );

      const { rows } = await c.query<{ acknowledged_at: Date | null }>(
        "select acknowledged_at from public.coaching_sessions where id = $1",
        [id],
      );
      expect(rows[0]?.acknowledged_at).toBeNull();
    });
  });

  it("leaves it alone when something else changes", async () => {
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      const admin = await seedUser(c, { role: "admin" });
      const id = await seedScheduled(c, consultant.id, admin.id);

      await asOwner(c);
      await c.query(
        "update public.coaching_sessions set acknowledged_at = now() where id = $1",
        [id],
      );

      await actAs(c, admin.id);
      await c.query(
        "update public.coaching_sessions set location = 'Meeting room 2' where id = $1",
        [id],
      );

      const { rows } = await c.query<{ acknowledged_at: Date | null }>(
        "select acknowledged_at from public.coaching_sessions where id = $1",
        [id],
      );
      expect(rows[0]?.acknowledged_at).not.toBeNull();
    });
  });
});

describe("the shape of a session is enforced by the database", () => {
  it("refuses a cancellation with no reason", async () => {
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      const admin = await seedUser(c, { role: "admin" });
      await asOwner(c);

      await expectRejection(() =>
        c.query(
          `insert into public.coaching_sessions
             (consultant_id, created_by, title, category, status, scheduled_at, cancelled_at)
           values ($1, $2, 'Review', 'monthly_review', 'cancelled', now(), now())`,
          [consultant.id, admin.id],
        ),
      );
    });
  });

  it("refuses a decline with no reason", async () => {
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      await asOwner(c);

      await expectRejection(() =>
        c.query(
          `insert into public.coaching_sessions
             (consultant_id, created_by, title, category, status, cancelled_at)
           values ($1, $1, 'Review', 'ad_hoc', 'declined', now())`,
          [consultant.id],
        ),
      );
    });
  });

  it("refuses a scheduled session with no time", async () => {
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      const admin = await seedUser(c, { role: "admin" });
      await asOwner(c);

      await expectRejection(() =>
        c.query(
          `insert into public.coaching_sessions
             (consultant_id, created_by, title, category, status)
           values ($1, $2, 'Review', 'monthly_review', 'scheduled')`,
          [consultant.id, admin.id],
        ),
      );
    });
  });

  it("refuses an unknown category", async () => {
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      const admin = await seedUser(c, { role: "admin" });
      await asOwner(c);

      await expectRejection(() =>
        c.query(
          `insert into public.coaching_sessions
             (consultant_id, created_by, title, category, status, scheduled_at)
           values ($1, $2, 'Review', 'quarterly_review', 'scheduled', now())`,
          [consultant.id, admin.id],
        ),
      );
    });
  });

  it("lets an acknowledged session be completed", async () => {
    // The bug an admin hit in real use: once the consultant tapped "Got it",
    // Complete failed outright. The acknowledgement is a historical fact and
    // must survive the session finishing - the export reports on it.
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      const admin = await seedUser(c, { role: "admin" });
      const id = await seedScheduled(c, consultant.id, admin.id, "-1 hour");

      await actAs(c, consultant.id);
      await c.query(
        "update public.coaching_sessions set acknowledged_at = now() where id = $1",
        [id],
      );

      await actAs(c, admin.id);
      await c.query(
        "update public.coaching_sessions set status = 'completed', completed_at = now() where id = $1",
        [id],
      );

      await asOwner(c);
      const { rows } = await c.query<{
        status: string;
        acknowledged_at: Date | null;
      }>(
        "select status, acknowledged_at from public.coaching_sessions where id = $1",
        [id],
      );
      expect(rows[0]?.status).toBe("completed");
      expect(rows[0]?.acknowledged_at).not.toBeNull();
    });
  });

  it("lets an acknowledged session be marked missed", async () => {
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      const admin = await seedUser(c, { role: "admin" });
      const id = await seedScheduled(c, consultant.id, admin.id, "-1 hour");

      await actAs(c, consultant.id);
      await c.query(
        "update public.coaching_sessions set acknowledged_at = now() where id = $1",
        [id],
      );

      await actAs(c, admin.id);
      await c.query(
        "update public.coaching_sessions set status = 'missed' where id = $1",
        [id],
      );

      await asOwner(c);
      const { rows } = await c.query<{ status: string }>(
        "select status from public.coaching_sessions where id = $1",
        [id],
      );
      expect(rows[0]?.status).toBe("missed");
    });
  });

  it("refuses to complete a request that has no time yet", async () => {
    // Reachable from the admin list: Complete and Missed used to be offered on
    // a pending request, and both failed with an unexplained error.
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      await asOwner(c);
      const {
        rows: [row],
      } = await c.query<{ id: string }>(
        `insert into public.coaching_sessions
           (consultant_id, created_by, title, category, status, requested_topic)
         values ($1, $1, 'Coaching request', 'ad_hoc', 'requested', 'Closing')
         returning id`,
        [consultant.id],
      );

      await expectRejection(() =>
        c.query(
          "update public.coaching_sessions set status = 'completed', completed_at = now() where id = $1",
          [row!.id],
        ),
      );
    });
  });

  it("lets a cancelled session drop its completion time", async () => {
    // Cancelling something already completed has to clear completed_at, or the
    // row is left in a state the constraints refuse.
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      const admin = await seedUser(c, { role: "admin" });
      await asOwner(c);
      const {
        rows: [row],
      } = await c.query<{ id: string }>(
        `insert into public.coaching_sessions
           (consultant_id, created_by, title, category, status, scheduled_at, completed_at)
         values ($1, $2, 'Review', 'monthly_review', 'completed',
                 now() - interval '1 day', now())
         returning id`,
        [consultant.id, admin.id],
      );

      await actAs(c, admin.id);
      await c.query(
        `update public.coaching_sessions
            set status = 'cancelled', cancelled_at = now(),
                cancellation_reason = 'Recorded by mistake', completed_at = null
          where id = $1`,
        [row!.id],
      );

      await asOwner(c);
      const { rows } = await c.query<{ status: string }>(
        "select status from public.coaching_sessions where id = $1",
        [row!.id],
      );
      expect(rows[0]?.status).toBe("cancelled");
    });
  });

  it("still refuses an acknowledgement on a request", async () => {
    // The guard the constraint was actually for: there is nothing to
    // acknowledge until a time exists.
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      await asOwner(c);

      await expectRejection(() =>
        c.query(
          `insert into public.coaching_sessions
             (consultant_id, created_by, title, category, status, acknowledged_at)
           values ($1, $1, 'Review', 'ad_hoc', 'requested', now())`,
          [consultant.id],
        ),
      );
    });
  });

  it("refuses an acknowledgement on a session that is not scheduled", async () => {
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      await asOwner(c);

      await expectRejection(() =>
        c.query(
          `insert into public.coaching_sessions
             (consultant_id, created_by, title, category, status, acknowledged_at)
           values ($1, $1, 'Review', 'ad_hoc', 'requested', now())`,
          [consultant.id],
        ),
      );
    });
  });
});

describe("coaching is never deleted", () => {
  it("refuses a delete from a consultant", async () => {
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      const admin = await seedUser(c, { role: "admin" });
      const id = await seedScheduled(c, consultant.id, admin.id);

      await actAs(c, consultant.id);
      await expectRejection(() =>
        c.query("delete from public.coaching_sessions where id = $1", [id]),
      );
    });
  });

  it("refuses a delete even from an admin", async () => {
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      const admin = await seedUser(c, { role: "admin" });
      const id = await seedScheduled(c, consultant.id, admin.id);

      await actAs(c, admin.id);
      await expectRejection(() =>
        c.query("delete from public.coaching_sessions where id = $1", [id]),
      );
    });
  });
});

describe("notification bookkeeping", () => {
  it("cannot send the same reminder twice for one session", async () => {
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      const admin = await seedUser(c, { role: "admin" });
      const id = await seedScheduled(c, consultant.id, admin.id);

      await asOwner(c);
      await c.query(
        "insert into public.coaching_reminders_sent (session_id, kind, status) values ($1, 'day_before', 'sent')",
        [id],
      );

      await expectRejection(() =>
        c.query(
          "insert into public.coaching_reminders_sent (session_id, kind, status) values ($1, 'day_before', 'sent')",
          [id],
        ),
      );
    });
  });

  it("keeps two sessions on the same day apart", async () => {
    // The reason this table is keyed by session and not by date: a review at
    // 10am and an ad-hoc at 4pm would otherwise collide and the second would
    // silently never be sent.
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      const admin = await seedUser(c, { role: "admin" });
      const morning = await seedScheduled(c, consultant.id, admin.id, "1 day");
      const afternoon = await seedScheduled(c, consultant.id, admin.id, "1 day");

      await asOwner(c);
      await c.query(
        `insert into public.coaching_reminders_sent (session_id, kind, status)
         values ($1, 'morning_of', 'sent'), ($2, 'morning_of', 'sent')`,
        [morning, afternoon],
      );

      const { rows } = await c.query(
        "select * from public.coaching_reminders_sent",
      );
      expect(rows).toHaveLength(2);
    });
  });

  it("refuses a failed reminder with no explanation", async () => {
    await withRollback(async (c) => {
      const consultant = await seedUser(c);
      const admin = await seedUser(c, { role: "admin" });
      const id = await seedScheduled(c, consultant.id, admin.id);

      await asOwner(c);
      await expectRejection(() =>
        c.query(
          "insert into public.coaching_reminders_sent (session_id, kind, status) values ($1, 'day_before', 'failed')",
          [id],
        ),
      );
    });
  });
});

/**
 * Every move the admin screen can actually make.
 *
 * Three bugs reached real use before this existed, all the same shape: a
 * transition the buttons offered that a CHECK constraint refused, surfacing as
 * an unexplained "could not be updated". Each was fixed individually, which is
 * not the same as knowing there are no more.
 *
 * So this walks the state machine rather than sampling it. Each case writes
 * exactly what the corresponding server action writes - including the columns
 * it clears - so a constraint that would reject the real update rejects this
 * too.
 */
describe("every transition the admin screen offers actually works", () => {
  type Move = {
    from: string;
    to: string;
    /** What the action sets, beyond the status itself. */
    set: string;
    /** Whether the consultant had acknowledged first. */
    acknowledged?: boolean;
  };

  const moves: Move[] = [
    // Scheduling or declining a request.
    { from: "requested", to: "scheduled", set: "scheduled_at = now() + interval '1 day'" },
    { from: "requested", to: "declined", set: "cancelled_at = now(), cancellation_reason = 'Covered already'" },

    // Closing out a scheduled session, with and without an acknowledgement.
    { from: "scheduled", to: "completed", set: "completed_at = now()" },
    { from: "scheduled", to: "completed", set: "completed_at = now()", acknowledged: true },
    { from: "scheduled", to: "missed", set: "completed_at = null" },
    { from: "scheduled", to: "missed", set: "completed_at = null", acknowledged: true },
    { from: "scheduled", to: "cancelled", set: "cancelled_at = now(), cancellation_reason = 'Clash', acknowledged_at = null, completed_at = null" },
    { from: "scheduled", to: "cancelled", set: "cancelled_at = now(), cancellation_reason = 'Clash', acknowledged_at = null, completed_at = null", acknowledged: true },

    // Rescheduling in place.
    { from: "scheduled", to: "scheduled", set: "scheduled_at = now() + interval '9 days'" },
    { from: "scheduled", to: "scheduled", set: "scheduled_at = now() + interval '9 days'", acknowledged: true },

    // Reopening.
    { from: "completed", to: "scheduled", set: "completed_at = null" },
    { from: "missed", to: "scheduled", set: "completed_at = null" },

    // Correcting a mistake after the fact.
    { from: "completed", to: "cancelled", set: "cancelled_at = now(), cancellation_reason = 'Recorded by mistake', acknowledged_at = null, completed_at = null" },
    { from: "missed", to: "completed", set: "completed_at = now()" },
  ];

  it.each(moves)(
    "$from -> $to ($acknowledged)",
    async ({ from, to, set, acknowledged }) => {
      await withRollback(async (c) => {
        const consultant = await seedUser(c);
        const admin = await seedUser(c, { role: "admin" });
        await asOwner(c);

        // Build a row in the starting state, exactly as the app would hold it.
        const scheduledAt =
          from === "requested" ? null : "now() - interval '1 hour'";
        const completedAt = from === "completed" ? "now()" : "null";

        const {
          rows: [row],
        } = await c.query<{ id: string }>(
          `insert into public.coaching_sessions
             (consultant_id, created_by, title, category, status,
              scheduled_at, completed_at, acknowledged_at)
           values ($1, $2, 'Review', 'monthly_review', $3,
                   ${scheduledAt ?? "null"}, ${completedAt},
                   ${acknowledged && from === "scheduled" ? "now()" : "null"})
           returning id`,
          [consultant.id, admin.id, from],
        );

        await actAs(c, admin.id);
        await c.query(
          `update public.coaching_sessions set status = $2, ${set} where id = $1`,
          [row!.id, to],
        );

        await asOwner(c);
        const { rows } = await c.query<{ status: string }>(
          "select status from public.coaching_sessions where id = $1",
          [row!.id],
        );
        expect(rows[0]?.status).toBe(to);
      });
    },
  );
});
