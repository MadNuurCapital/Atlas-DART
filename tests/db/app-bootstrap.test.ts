import { describe, it, expect } from "vitest";
import {
  withRollback,
  actAs,
  seedUser,
  seedSubmission,
} from "./helpers.ts";

/**
 * app_bootstrap() replaces the two queries the app shell ran before it could
 * draw: who is asking, and whether they have submitted the day being chased.
 *
 * The shell renders on EVERY page, so this saves more total latency across the
 * app than the dashboard change did - but it also means a mistake here is
 * visible on every page rather than one. Hence the same standard as 0023: run
 * the original queries and the new function against the same data, as the same
 * user, and compare as JSON on both sides.
 */

const DAY = "2026-03-02";

describe("app_bootstrap returns what the two queries returned", () => {
  it("returns the caller's own profile, column for column", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client, { fullName: "Siti Advisor" });
      await actAs(client, user.id);

      const direct = await client.query(
        "select to_jsonb(p) as profile from public.profiles p where p.id = auth.uid()",
      );
      const { rows } = await client.query(
        "select public.app_bootstrap($1) as b",
        [DAY],
      );

      expect(rows[0].b.profile).toEqual(direct.rows[0].profile);
      expect(rows[0].b.profile.full_name).toBe("Siti Advisor");
      expect(rows[0].b.profile.role).toBe("consultant");
    });
  });

  it("reports a submitted day as submitted", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      await seedSubmission(client, user.id, DAY, { status: "submitted" });
      await actAs(client, user.id);

      const { rows } = await client.query(
        "select public.app_bootstrap($1) as b",
        [DAY],
      );
      expect(rows[0].b.nag_status).toBe("submitted");
    });
  });

  it("reports a draft as a draft, which the banner treats as not submitted", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      await seedSubmission(client, user.id, DAY, { status: "draft" });
      await actAs(client, user.id);

      const { rows } = await client.query(
        "select public.app_bootstrap($1) as b",
        [DAY],
      );
      // A half-filled form is not a submission. The banner must still nag.
      expect(rows[0].b.nag_status).toBe("draft");
      expect(rows[0].b.nag_status).not.toBe("submitted");
    });
  });

  it("returns null when nothing is recorded for that day", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      await actAs(client, user.id);

      const { rows } = await client.query(
        "select public.app_bootstrap($1) as b",
        [DAY],
      );
      expect(rows[0].b.nag_status).toBeNull();
    });
  });

  it("answers about the date asked for, not about today", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      // Between midnight and 6am the day being chased is yesterday. The rule
      // lives in lib/nag.ts and is passed in; this proves the function honours
      // the date it is given rather than quietly using its own clock.
      await seedSubmission(client, user.id, "2026-03-01", {
        status: "submitted",
      });
      await actAs(client, user.id);

      const yesterday = await client.query(
        "select public.app_bootstrap($1) as b",
        ["2026-03-01"],
      );
      const today = await client.query(
        "select public.app_bootstrap($1) as b",
        ["2026-03-02"],
      );

      expect(yesterday.rows[0].b.nag_status).toBe("submitted");
      expect(today.rows[0].b.nag_status).toBeNull();
    });
  });
});

describe("app_bootstrap cannot be pointed at anyone else", () => {
  it("never returns another person's profile or submission", async () => {
    await withRollback(async (client) => {
      const mine = await seedUser(client, { fullName: "Mine" });
      const theirs = await seedUser(client, { fullName: "Theirs" });
      await seedSubmission(client, theirs.id, DAY, { status: "submitted" });

      await actAs(client, mine.id);
      const { rows } = await client.query(
        "select public.app_bootstrap($1) as b",
        [DAY],
      );

      expect(rows[0].b.profile.id).toBe(mine.id);
      // Their submitted day must not leak in and silence my banner.
      expect(rows[0].b.nag_status).toBeNull();
      expect(JSON.stringify(rows[0].b)).not.toContain(theirs.id);
      expect(JSON.stringify(rows[0].b)).not.toContain("Theirs");
    });
  });

  it("is SECURITY INVOKER, so RLS is still the boundary", async () => {
    await withRollback(async (client) => {
      const { rows } = await client.query(
        "select prosecdef from pg_proc where proname = 'app_bootstrap'",
      );
      expect(rows[0].prosecdef).toBe(false);
    });
  });

  it("gives an anonymous caller a null profile, which means the login screen", async () => {
    await withRollback(async (client) => {
      const user = await seedUser(client);
      await seedSubmission(client, user.id, DAY, { status: "submitted" });

      await actAs(client, null);
      const { rows } = await client.query(
        "select public.app_bootstrap($1) as b",
        [DAY],
      );

      expect(rows[0].b.profile).toBeNull();
      expect(rows[0].b.nag_status).toBeNull();
    });
  });
});
