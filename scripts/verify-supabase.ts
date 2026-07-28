/**
 * Verify a real Supabase project.
 *
 * Everything in this repository is tested against a local PostgreSQL with a
 * Supabase compatibility shim. That proves the SQL and the policies are
 * correct, but it cannot prove they were applied to YOUR project, or that the
 * pieces Supabase manages itself - Realtime, the auth schema - line up.
 *
 * This script checks exactly that, and is the difference between "the tests
 * pass" and "it works".
 *
 *   SUPABASE_DB_URL="postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres" \
 *     npm run verify:supabase
 *
 * The connection string is in Supabase under Settings -> Database -> Connection
 * string -> URI. Use the direct connection, not the pooler: the pooler does not
 * expose the catalogue tables this needs.
 *
 * Read-only. It inspects and reports; it never writes.
 */

import { Client } from "pg";

type Status = "pass" | "fail" | "warn";

type Check = {
  name: string;
  status: Status;
  detail: string;
  /** What to do about it, when it is not a pass. */
  fix?: string;
};

const EXPECTED_TABLES = [
  "appointment_activities",
  "audit_logs",
  "cases",
  "consultant_targets",
  "daily_submissions",
  "insurers",
  "profiles",
  "reminder_logs",
];

const EXPECTED_VIEWS = [
  "v_case_mix_by_category",
  "v_case_totals",
  "v_daily_consultant_summary",
  "v_missing_submissions",
  "v_monthly_consultant_gr",
  "v_pending_inception",
  "v_target_shortfall",
  "v_yearly_consultant_gr",
];

const EXPECTED_FUNCTIONS = [
  "is_admin",
  "missing_submissions",
  "monthly_compliance",
  "sg_deadline",
  "sg_today",
  "team_daily",
  "within_edit_window",
];

const REALTIME_TABLES = [
  "appointment_activities",
  "cases",
  "daily_submissions",
];

const checks: Check[] = [];

function record(check: Check) {
  checks.push(check);
}

async function main() {
  const url = process.env.SUPABASE_DB_URL;

  if (!url) {
    console.error(
      [
        "SUPABASE_DB_URL is not set.",
        "",
        "Find it in Supabase: Settings -> Database -> Connection string -> URI.",
        "Use the DIRECT connection, not the pooler.",
        "",
        '  SUPABASE_DB_URL="postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres" \\',
        "    npm run verify:supabase",
      ].join("\n"),
    );
    process.exit(2);
  }

  const client = new Client({
    connectionString: url,
    // Supabase terminates TLS with its own chain; verification is handled by
    // the platform and this is a one-off administrative connection.
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
  } catch (error) {
    console.error(
      `Could not connect: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error(
      "\nCheck the password in the URI, and that you are using the direct connection rather than the pooler.",
    );
    process.exit(2);
  }

  // ---- Tables -----------------------------------------------------------
  const tables = await client.query<{ relname: string; forced: boolean }>(
    `select relname, relforcerowsecurity as forced
       from pg_class
      where relnamespace = 'public'::regnamespace and relkind = 'r'
      order by relname`,
  );
  const tableNames = tables.rows.map((r) => r.relname);
  const missingTables = EXPECTED_TABLES.filter((t) => !tableNames.includes(t));

  record({
    name: "Tables",
    status: missingTables.length === 0 ? "pass" : "fail",
    detail:
      missingTables.length === 0
        ? `all ${EXPECTED_TABLES.length} present`
        : `missing: ${missingTables.join(", ")}`,
    fix: "Apply every file in supabase/migrations/ in filename order.",
  });

  // ---- Row Level Security ----------------------------------------------
  const unforced = tables.rows
    .filter((r) => EXPECTED_TABLES.includes(r.relname) && !r.forced)
    .map((r) => r.relname);

  record({
    name: "RLS forced",
    status: unforced.length === 0 && missingTables.length === 0 ? "pass" : "fail",
    detail:
      unforced.length === 0
        ? "every table forces row level security"
        : `NOT forced on: ${unforced.join(", ")}`,
    fix: "Re-apply 0011_rls.sql. Plain ENABLE exempts the table owner; FORCE does not.",
  });

  const policyCount = await client.query<{ n: string }>(
    `select count(*)::text as n from pg_policies where schemaname = 'public'`,
  );
  record({
    name: "Policies",
    status: Number(policyCount.rows[0]!.n) >= 20 ? "pass" : "fail",
    detail: `${policyCount.rows[0]!.n} policies defined`,
    fix: "Re-apply 0011_rls.sql.",
  });

  // The single most dangerous default in this stack: a view without
  // security_invoker runs as its owner and is a complete RLS bypass.
  const views = await client.query<{ viewname: string; invoker: string | null }>(
    `select c.relname as viewname,
            (select option_value from pg_options_to_table(c.reloptions)
              where option_name = 'security_invoker') as invoker
       from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
      order by c.relname`,
  );
  const viewNames = views.rows.map((r) => r.viewname);
  const missingViews = EXPECTED_VIEWS.filter((v) => !viewNames.includes(v));
  const leakyViews = views.rows
    .filter((r) => r.invoker !== "true")
    .map((r) => r.viewname);

  record({
    name: "Views",
    status: missingViews.length === 0 ? "pass" : "fail",
    detail:
      missingViews.length === 0
        ? `all ${EXPECTED_VIEWS.length} present`
        : `missing: ${missingViews.join(", ")}`,
    fix: "Apply 0010_views.sql.",
  });

  record({
    name: "Views are security_invoker",
    status: leakyViews.length === 0 && missingViews.length === 0 ? "pass" : "fail",
    detail:
      leakyViews.length === 0
        ? "every view respects the caller's RLS"
        : `RLS BYPASS on: ${leakyViews.join(", ")}`,
    fix: "Re-apply 0010_views.sql. Without this flag any consultant can read the whole team through the view.",
  });

  // ---- Functions and triggers ------------------------------------------
  const fns = await client.query<{ proname: string }>(
    `select distinct proname from pg_proc
      where pronamespace = 'public'::regnamespace order by proname`,
  );
  const fnNames = fns.rows.map((r) => r.proname);
  const missingFns = EXPECTED_FUNCTIONS.filter((f) => !fnNames.includes(f));

  record({
    name: "Functions",
    status: missingFns.length === 0 ? "pass" : "fail",
    detail:
      missingFns.length === 0
        ? `all ${EXPECTED_FUNCTIONS.length} present`
        : `missing: ${missingFns.join(", ")}`,
    fix: "Apply 0001_helpers.sql, 0002_profiles.sql and 0010_views.sql.",
  });

  // The one trigger that lives outside our own schema, and the most likely
  // thing to have silently failed: creating it needs rights on auth.users.
  const signupTrigger = await client.query<{ n: string }>(
    `select count(*)::text as n from pg_trigger
      where tgname = 'on_auth_user_created' and not tgisinternal`,
  );
  record({
    name: "Signup trigger",
    status: Number(signupTrigger.rows[0]!.n) > 0 ? "pass" : "fail",
    detail:
      Number(signupTrigger.rows[0]!.n) > 0
        ? "profiles are created automatically on signup"
        : "on_auth_user_created is MISSING",
    fix: "Re-run 0002_profiles.sql as the postgres role. Without it an invited user signs in with no profile and is immediately signed out.",
  });

  const triggers = await client.query<{ n: string }>(
    `select count(*)::text as n from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
      where c.relnamespace = 'public'::regnamespace and not t.tgisinternal`,
  );
  // Eleven on public tables: five updated_at stamps, submission timing,
  // appointment parentage, insurer normalisation, and the profile and case
  // guards. The twelfth - on_auth_user_created - lives on auth.users and is
  // checked separately above.
  record({
    name: "Business-rule triggers",
    status: Number(triggers.rows[0]!.n) >= 11 ? "pass" : "warn",
    detail: `${triggers.rows[0]!.n} triggers on public tables`,
    fix: "Expect at least 11. Re-apply the table migrations if fewer.",
  });

  // ---- Realtime ---------------------------------------------------------
  const publication = await client.query<{ tablename: string }>(
    `select tablename from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public'`,
  );
  const published = publication.rows.map((r) => r.tablename);
  const notPublished = REALTIME_TABLES.filter((t) => !published.includes(t));

  record({
    name: "Realtime publication",
    status: notPublished.length === 0 ? "pass" : "fail",
    detail:
      notPublished.length === 0
        ? "the admin board will update live"
        : `not published: ${notPublished.join(", ")}`,
    fix: "Apply 0013_realtime.sql, or add them under Database -> Replication.",
  });

  const replicaIdentity = await client.query<{ relname: string; ri: string }>(
    `select relname, relreplident as ri from pg_class
      where relnamespace = 'public'::regnamespace
        and relname = any($1::text[])`,
    [REALTIME_TABLES],
  );
  const partialIdentity = replicaIdentity.rows
    .filter((r) => r.ri !== "f")
    .map((r) => r.relname);

  record({
    name: "Replica identity",
    status: partialIdentity.length === 0 ? "pass" : "warn",
    detail:
      partialIdentity.length === 0
        ? "subscribers receive the full old row"
        : `only the key is sent for: ${partialIdentity.join(", ")}`,
    fix: "Apply 0013_realtime.sql. Without FULL, a subscriber cannot tell what changed.",
  });

  const walLevel = await client.query<{ setting: string }>(
    `select setting from pg_settings where name = 'wal_level'`,
  );
  record({
    name: "wal_level",
    status: walLevel.rows[0]?.setting === "logical" ? "pass" : "fail",
    detail: `wal_level = ${walLevel.rows[0]?.setting ?? "unknown"}`,
    fix: "Supabase sets this to logical by default. If it is not, Realtime cannot work at all - raise it with Supabase support.",
  });

  // ---- Data -------------------------------------------------------------
  const insurers = await client.query<{ n: string }>(
    `select count(*)::text as n from public.insurers where active`,
  );
  record({
    name: "Insurers seeded",
    status: Number(insurers.rows[0]!.n) > 0 ? "pass" : "warn",
    detail: `${insurers.rows[0]!.n} active insurers`,
    fix: "Apply 0012_seed_insurers.sql, or let consultants add their own as they go.",
  });

  const insurerDupIndex = await client.query<{ n: string }>(
    `select count(*)::text as n from pg_indexes
      where schemaname = 'public' and indexname = 'insurers_name_unique'`,
  );
  record({
    name: "Insurer de-duplication",
    status: Number(insurerDupIndex.rows[0]!.n) > 0 ? "pass" : "fail",
    detail:
      Number(insurerDupIndex.rows[0]!.n) > 0
        ? "the same insurer cannot exist twice"
        : "unique index MISSING - reporting will fragment",
    fix: "Apply 0006_insurers.sql.",
  });

  const admins = await client.query<{ n: string; names: string | null }>(
    `select count(*)::text as n, string_agg(full_name, ', ') as names
       from public.profiles where role = 'admin' and active`,
  );
  record({
    name: "Admin accounts",
    status: Number(admins.rows[0]!.n) > 0 ? "pass" : "fail",
    detail:
      Number(admins.rows[0]!.n) > 0
        ? `${admins.rows[0]!.n}: ${admins.rows[0]!.names}`
        : "no active admin exists",
    fix: "Create a user in Authentication -> Users, then:  update public.profiles set role = 'admin' where email = '...';",
  });

  const people = await client.query<{ n: string }>(
    `select count(*)::text as n from public.profiles where active`,
  );
  record({
    name: "People",
    status: "pass",
    detail: `${people.rows[0]!.n} active`,
  });

  // ---- Sanity: does the app's own notion of today work here? ------------
  const sgToday = await client.query<{ d: string; deadline: string }>(
    `select public.sg_today()::text as d,
            public.sg_deadline(public.sg_today())::text as deadline`,
  );
  record({
    name: "Singapore date",
    status: "pass",
    detail: `today is ${sgToday.rows[0]!.d}, deadline ${sgToday.rows[0]!.deadline}`,
  });

  // ---- Environment ------------------------------------------------------
  for (const [key, hint] of [
    ["NEXT_PUBLIC_SUPABASE_URL", "the project URL"],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "starts sb_publishable_"],
    ["SUPABASE_SECRET_KEY", "starts sb_secret_ - server only"],
    ["RESEND_API_KEY", "starts re_"],
    ["REMINDER_FROM_EMAIL", "a verified Resend sender"],
    ["APP_URL", "used for links inside reminder emails"],
    ["REMINDER_TEST_TOKEN", "guards the manual reminder trigger"],
  ] as const) {
    const value = process.env[key];
    record({
      name: `env ${key}`,
      status: value ? "pass" : "warn",
      detail: value ? "set" : `not set locally (${hint})`,
      fix: "Required in Netlify before the reminders or the export will run. Not needed to run this script.",
    });
  }

  await client.end();
  report();
}

function report() {
  const width = Math.max(...checks.map((c) => c.name.length)) + 2;
  const icon: Record<Status, string> = { pass: "PASS", fail: "FAIL", warn: "WARN" };

  console.log("\nSupabase installation check\n" + "=".repeat(60));

  for (const check of checks) {
    console.log(
      `${icon[check.status].padEnd(5)} ${check.name.padEnd(width)} ${check.detail}`,
    );
  }

  const failures = checks.filter((c) => c.status === "fail");
  const warnings = checks.filter((c) => c.status === "warn");

  console.log("=".repeat(60));
  console.log(
    `${checks.length - failures.length - warnings.length} passed, ${warnings.length} warnings, ${failures.length} failures\n`,
  );

  if (failures.length > 0) {
    console.log("Must be fixed before anyone uses this:\n");
    for (const f of failures) {
      console.log(`  ${f.name}: ${f.detail}`);
      if (f.fix) console.log(`    -> ${f.fix}\n`);
    }
  }

  if (warnings.length > 0 && failures.length === 0) {
    console.log("Worth a look, but not blocking:\n");
    for (const w of warnings) console.log(`  ${w.name}: ${w.detail}`);
    console.log();
  }

  if (failures.length === 0) {
    console.log(
      "The database is set up correctly. Next: sign in, submit a day on a phone,\n" +
        "and confirm it appears on /admin/daily without refreshing.\n",
    );
  }

  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("\nverify-supabase failed:", error);
  process.exit(2);
});
