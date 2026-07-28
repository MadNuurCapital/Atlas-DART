# Testing

**239 tests today, all passing.** Four suites with different jobs.

| Suite | Count | Command | Needs |
|---|---|---|---|
| Unit | 110 | `npm test` | nothing |
| Component | 32 | `npm run test:components` | jsdom |
| Database / RLS | 83 | `npm run test:db` | PostgreSQL 16 |
| End-to-end | 14 | `npm run test:e2e` | a build + Chromium |

## Unit — `tests/unit/`

Pure logic, no I/O. Singapore date conversion including the UTC-midnight boundary, deadline and on-time derivation, target resolution and shortfall arithmetic, compliance percentages, currency formatting, and the guard proving the service-role key cannot reach the browser.

These are the tests most likely to catch a real bug: one of them found an off-by-999ms error in the timezone offset calculation that would have mismarked submissions made in the final second before the deadline.

## Component — `tests/components/`

React Testing Library against a real DOM. Server actions are mocked — what they
do is covered by the database suite; what is under test here is the component.

These target the behaviours that would quietly cost someone their compliance:
a double-tap sending two submissions, the confirmation dialog showing stale
numbers because it renders in a portal outside the form, a locked day still
accepting input, cancelling a case without demanding a reason, and the audit
diff listing fields that did not actually change.

Each file opts into jsdom with a `@vitest-environment jsdom` docblock. Booting
jsdom for the date and SQL suites would cost time for nothing.

## Database — `tests/db/`

The Row Level Security policies executed against real PostgreSQL, not asserted about.

Supabase provides an `auth` schema, an `auth.uid()` function and the `anon`/`authenticated`/`service_role` roles. Stock Postgres has none of those, so `tests/db/shim.sql` recreates exactly those pieces — no more — and the real migrations then apply unmodified.

```bash
sudo pg_ctlcluster 16 main start
./scripts/test-db.sh
export TEST_DATABASE_URL="postgresql://dart_test:dart_test@127.0.0.1:5432/dart_test"
npm run test:db
```

Tests impersonate a signed-in user exactly the way Supabase does:

```sql
set local role authenticated;
select set_config('request.jwt.claim.sub', '<uuid>', true);
```

Every test runs in a transaction that is rolled back, so the database is left as it was found.

### The canary

The first test in `rls.test.ts` asserts that `current_user` is `authenticated` and that the role does not carry `BYPASSRLS`. This matters: the harness grants `BYPASSRLS` to the owning role so that migrations can seed data through forced RLS, mirroring how Supabase runs migrations as its `postgres` role. If a future change caused tests to run as that owner, every other assertion in the file would pass vacuously. The canary fails loudly instead.

A second test asserts all eight tables still have RLS **forced** rather than merely enabled.

### What is covered

Cross-consultant isolation on submissions, appointments, cases and the summary view · privilege escalation on role, activation and targets · the 7-day edit window including the day-8 rejection and future dates · admin override · deletion being impossible on cases, submissions and audit logs · the submission-timing trigger including double-click idempotency and backdating attempts · appointment counts moving as rows are added, retyped and removed · cancellation removing GR while the row survives · admin-only restoration · GR crediting the submitted month · pending inception · case mix by category · insurer de-duplication · target history and no-target handling.

## End-to-end — `tests/e2e/`

Playwright against a production build, on a Pixel 7 viewport and a desktop one.

```bash
npm run test:e2e
```

Currently covers the unauthenticated paths — redirect to login, the `redirectTo` round-trip, admin routes being closed, server-side validation, the deliberately vague credential error, and the login page not scrolling horizontally on a phone. Signed-in journeys arrive with Phase 2, once there are seeded accounts to sign in as.

### If Chromium will not launch

Some environments ship a pre-installed Chromium whose build number differs from the one this Playwright version expects. Point at it rather than downloading:

```bash
export PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium
npm run test:e2e
```

`playwright.config.ts` uses that variable when set and resolves normally otherwise.

## Before every commit

```bash
npm run lint && npm run typecheck && npm run test:all
```

## Known gaps

- RLS is verified against PostgreSQL 16 with the auth shim, **not yet against the real Supabase project**. Re-run `npm run test:db` against the live database once it exists, and treat that as the real sign-off.
- The invite flow in `/admin/users` calls Supabase's Admin API, which has no local equivalent. Its validation, duplicate detection and last-admin guard are covered; **the actual invite call is untested** until there is a project to call. Send one invitation to yourself before inviting the team.
- Signed-in end-to-end journeys need seeded Supabase accounts. The E2E suite currently covers the unauthenticated paths only.
- `npm audit` reports advisories in Next's own bundled `postcss` and `sharp`, and in `uuid` beneath `exceljs`. `npm audit fix --force` would downgrade Next to 9.3.3 and exceljs to 3.4.0, so they are knowingly left alone pending upstream releases.
