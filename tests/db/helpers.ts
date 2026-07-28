import { Pool, type PoolClient } from "pg";
import { randomUUID } from "node:crypto";

/**
 * Test harness for the Row Level Security policies.
 *
 * These tests run against a real PostgreSQL 16 database with the Supabase auth
 * shim applied (see scripts/test-db.sh), so the policies in 0011_rls.sql are
 * genuinely executed rather than merely reviewed.
 *
 * Every test runs inside a transaction that is rolled back afterwards, so the
 * database is left exactly as it was found.
 */

const url = process.env.TEST_DATABASE_URL;

if (!url) {
  throw new Error(
    [
      "TEST_DATABASE_URL is not set.",
      "",
      "Build the test database first:",
      "  ./scripts/test-db.sh",
      '  export TEST_DATABASE_URL="postgresql://dart_test:dart_test@127.0.0.1:5432/dart_test"',
    ].join("\n"),
  );
}

export const pool = new Pool({ connectionString: url, max: 4 });

/** Run a test body in a transaction and roll it back afterwards. */
export async function withRollback(
  fn: (client: PoolClient) => Promise<void>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await fn(client);
  } finally {
    try {
      await client.query("rollback");
    } catch {
      // Connection may already be aborted; rollback is best-effort.
    }
    client.release();
  }
}

/**
 * Act as a signed-in user for subsequent statements.
 *
 * This is the same mechanism Supabase uses: the JWT subject is exposed through
 * a GUC that auth.uid() reads, and the connection assumes the `authenticated`
 * role. Passing null drops back to an anonymous session.
 */
export async function actAs(
  client: PoolClient,
  userId: string | null,
): Promise<void> {
  await client.query("reset role");
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [
    userId ?? "",
  ]);
  await client.query("set local role authenticated");
}

/** Drop back to the owning role, which bypasses RLS, for test setup. */
export async function asOwner(client: PoolClient): Promise<void> {
  await client.query("reset role");
  await client.query("select set_config('request.jwt.claim.sub', '', true)");
}

export type SeededUser = {
  id: string;
  email: string;
  fullName: string;
  role: "consultant" | "admin";
};

/**
 * Create an auth user. The profile row is created by the on_auth_user_created
 * trigger from migration 0002, so this exercises that trigger too.
 */
export async function seedUser(
  client: PoolClient,
  opts: Partial<SeededUser> & { role?: "consultant" | "admin" } = {},
): Promise<SeededUser> {
  await asOwner(client);

  const id = opts.id ?? randomUUID();
  const email = opts.email ?? `${id.slice(0, 8)}@example.test`;
  const fullName = opts.fullName ?? `Test ${id.slice(0, 4)}`;
  const role = opts.role ?? "consultant";

  await client.query(
    `insert into auth.users (id, email, raw_user_meta_data)
     values ($1, $2, jsonb_build_object('full_name', $3::text, 'role', $4::text))`,
    [id, email, fullName, role],
  );

  return { id, email, fullName, role };
}

/** Insert a daily submission directly, bypassing RLS, for test setup. */
export async function seedSubmission(
  client: PoolClient,
  userId: string,
  businessDate: string,
  overrides: {
    dials?: number;
    talkedTo?: number;
    campaignStatus?: string;
    inOffice?: boolean;
    status?: "draft" | "submitted";
  } = {},
): Promise<string> {
  await asOwner(client);
  const { rows } = await client.query<{ id: string }>(
    `insert into public.daily_submissions
       (user_id, business_date, dials, talked_to, campaign_status, in_office, status)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id`,
    [
      userId,
      businessDate,
      overrides.dials ?? 10,
      overrides.talkedTo ?? 5,
      overrides.campaignStatus ?? "running",
      overrides.inOffice ?? true,
      overrides.status ?? "submitted",
    ],
  );
  return rows[0]!.id;
}

/** Insert an insurer directly, returning its id. */
export async function seedInsurer(
  client: PoolClient,
  name = `Insurer ${randomUUID().slice(0, 8)}`,
): Promise<string> {
  await asOwner(client);
  const { rows } = await client.query<{ id: string }>(
    `insert into public.insurers (name) values ($1) returning id`,
    [name],
  );
  return rows[0]!.id;
}

/** Insert a case directly, bypassing RLS, for test setup. */
export async function seedCase(
  client: PoolClient,
  consultantId: string,
  insurerId: string,
  overrides: {
    dateSubmitted?: string;
    dateIncepted?: string | null;
    policyType?: string;
    ape?: number;
    gr?: number;
    status?: "active" | "cancelled";
  } = {},
): Promise<string> {
  await asOwner(client);
  const { rows } = await client.query<{ id: string }>(
    `insert into public.cases
       (consultant_id, date_submitted, date_incepted, client_name, insurer_id,
        policy_name, policy_type, ape_amount, gr_amount, status)
     values ($1, $2, $3, 'Test Client', $4, 'Test Policy', $5, $6, $7, $8)
     returning id`,
    [
      consultantId,
      overrides.dateSubmitted ?? "2026-03-10",
      overrides.dateIncepted ?? null,
      insurerId,
      overrides.policyType ?? "Term",
      overrides.ape ?? 1000,
      overrides.gr ?? 500,
      overrides.status ?? "active",
    ],
  );
  return rows[0]!.id;
}

/** Today's Singapore date, as Postgres sees it. */
export async function sgToday(client: PoolClient): Promise<string> {
  const { rows } = await client.query<{ d: string }>(
    "select public.sg_today()::text as d",
  );
  return rows[0]!.d;
}

/** Assert that a query fails, and return the error for further inspection. */
export async function expectRejection(
  fn: () => Promise<unknown>,
): Promise<Error> {
  try {
    await fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error("Expected the statement to be rejected, but it succeeded");
}
