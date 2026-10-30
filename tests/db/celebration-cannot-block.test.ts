import { describe, it, expect } from "vitest";
import {
  withRollback,
  actAs,
  asOwner,
  seedUser,
  seedInsurer,
  seedCase,
} from "./helpers.ts";

/**
 * A case must save even when the celebration cannot be written.
 *
 * This is the regression test for the worst bug in this project so far.
 *
 * 0026 added an AFTER INSERT trigger on `cases` to announce the submission to
 * the team. An AFTER INSERT trigger runs inside the transaction that fired it,
 * so when the trigger raised, the case was rolled back with it. Submitting a
 * case stopped working, and the advisor was told only "That case could not be
 * saved."
 *
 * The tests already written for 0026 all passed, because they only ever asked
 * whether the celebration appeared when everything worked. None of them asked
 * what happens to the CASE when the celebration does not - and that is the
 * only question that actually mattered.
 *
 * So these tests break the announcement deliberately, in several different
 * ways, and assert the case is saved anyway.
 */

/** Make any write to team_events fail, as a broken policy or table would. */
async function breakTheAnnouncement(
  client: Parameters<typeof asOwner>[0],
): Promise<void> {
  await asOwner(client);
  await client.query(`
    create or replace function pg_temp.refuse_everything()
    returns trigger language plpgsql as $$
    begin
      raise exception 'team_events is unwritable in this test';
    end $$;

    create trigger zz_refuse_everything
      before insert on public.team_events
      for each row execute function pg_temp.refuse_everything();
  `);
}

describe("a broken celebration cannot cost somebody their case", () => {
  it("saves the case when the announcement raises", async () => {
    await withRollback(async (client) => {
      const zul = await seedUser(client, { fullName: "Zul Advisor" });
      const insurer = await seedInsurer(client);

      await breakTheAnnouncement(client);

      // seedCase inserts exactly as the application does.
      const caseId = await seedCase(client, zul.id, insurer, { gr: 900 });
      expect(caseId).toBeTruthy();

      await asOwner(client);
      const { rows } = await client.query(
        "select id, gr_amount from public.cases where id = $1",
        [caseId],
      );

      // The case is the thing that matters. It is somebody's commission.
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].gr_amount)).toBe(900);

      // And no celebration was written, which is the acceptable loss.
      const { rows: events } = await client.query(
        "select * from public.team_events",
      );
      expect(events).toHaveLength(0);
    });
  });

  it("saves the case when a signed-in consultant submits it", async () => {
    await withRollback(async (client) => {
      const zul = await seedUser(client);
      const insurer = await seedInsurer(client);

      await breakTheAnnouncement(client);
      await actAs(client, zul.id);

      // The real path: the authenticated role, through RLS, as PostgREST does.
      const { rows } = await client.query(
        `insert into public.cases
           (consultant_id, date_submitted, client_name, insurer_id,
            policy_name, policy_type, ape_amount, gr_amount, status)
         values (auth.uid(), '2026-03-10', 'Real Client', $1,
                 'Real Policy', 'Term', 1000, 500, 'active')
         returning id`,
        [insurer],
      );

      expect(rows).toHaveLength(1);
    });
  });

  it("still announces normally when nothing is broken", async () => {
    await withRollback(async (client) => {
      const zul = await seedUser(client, { fullName: "Zul Advisor" });
      const insurer = await seedInsurer(client);
      await seedCase(client, zul.id, insurer);

      await asOwner(client);
      const { rows } = await client.query(
        "select actor_name from public.team_events",
      );

      // The handler must not have turned the feature off.
      expect(rows).toHaveLength(1);
      expect(rows[0].actor_name).toBe("Zul Advisor");
    });
  });
});

describe("the tables the server writes are not FORCE-protected against it", () => {
  /**
   * FORCE ROW LEVEL SECURITY makes the table owner obey its own policies. That
   * is right for tables a user writes, and it is how the rest of this schema is
   * configured.
   *
   * It is wrong for these two. Their only writer is a SECURITY DEFINER trigger
   * running as the owner, and there is deliberately no insert policy for
   * anybody - so FORCE guaranteed that the one intended writer was refused.
   *
   * It did not fail locally because the harness grants BYPASSRLS to the owning
   * role, and BYPASSRLS defeats FORCE. Production's owner had no such
   * attribute. This asserts the configuration directly, because the behaviour
   * it causes is invisible on any database whose owner can bypass RLS.
   */
  it.each(["team_events", "notifications"])(
    "%s has RLS enabled but not forced",
    async (table) => {
      await withRollback(async (client) => {
        const { rows } = await client.query(
          `select c.relrowsecurity as enabled, c.relforcerowsecurity as forced
             from pg_class c
             join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = $1`,
          [table],
        );

        expect(rows[0].enabled).toBe(true);
        expect(rows[0].forced).toBe(false);
      });
    },
  );

  it.each(["team_events", "notifications"])(
    "%s still refuses an insert from a signed-in user",
    async (table) => {
      await withRollback(async (client) => {
        const user = await seedUser(client);
        await actAs(client, user.id);

        // Removing FORCE must not have opened anything to a client. Both gates
        // that face outwards - no insert policy, no insert grant - still hold.
        let failed = false;
        try {
          await client.query(
            table === "team_events"
              ? `insert into public.team_events (kind, actor_id, actor_name)
                 values ('case_submitted', auth.uid(), 'Forged')`
              : `insert into public.notifications
                   (user_id, kind, title, dedupe_key)
                 values (auth.uid(), 'milestone', 'Self awarded', 'forged')`,
          );
        } catch {
          failed = true;
        }
        expect(failed).toBe(true);
      });
    },
  );
});
