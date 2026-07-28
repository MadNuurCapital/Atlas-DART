# DART & Case Tracker

Mobile-first daily activity and signed-case tracking for **Integrated Barakah Wealth Advisory**.

Consultants submit their daily DART figures from a phone in under two minutes. Management sees the whole team live, without refreshing, and downloads a monthly Excel meeting report that reconciles exactly to the dashboard.

Replaces the per-consultant `Consultant_XXX.numbers` workbooks.

---

## Status

**All six phases complete.** The MVP is feature-complete and awaiting the client's Supabase, Netlify and Resend accounts.

| Phase | Scope | State |
|---|---|---|
| 1 | Scaffold, schema, RLS, auth, app shell | **Done** |
| 2 | Daily submission + appointments | **Done** |
| 3 | Cases, insurers, targets | **Done** |
| 4 | Admin dashboard + Realtime | **Done** |
| 5 | Six-sheet Excel export | **Done** |
| 6 | Reminders, audit logging, docs | **Done** |

Not yet built, and deliberately: the `/admin/users` invite screen agreed after Phase 1. It needs a live Supabase project to be worth testing.

## Stack

Next.js 16 (App Router) · TypeScript strict · Tailwind 4 · shadcn/ui on Radix · React Hook Form + Zod · Supabase (Postgres, Auth, RLS, Realtime) · Recharts · ExcelJS · Vitest · Playwright · Netlify + Scheduled Functions · Resend

## Getting started

```bash
npm install
cp .env.example .env.local     # fill in your Supabase values
npm run dev
```

### Database

Migrations live in `supabase/migrations/` and apply in filename order.

With the Supabase CLI (needs Docker):

```bash
supabase db reset
```

Without Docker — a real PostgreSQL 16 plus a small Supabase auth shim:

```bash
sudo pg_ctlcluster 16 main start
./scripts/test-db.sh
export TEST_DATABASE_URL="postgresql://dart_test:dart_test@127.0.0.1:5432/dart_test"
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests (pure logic, no database) |
| `npm run test:db` | Row Level Security suite against real Postgres |
| `npm run test:all` | Both of the above |
| `npm run test:e2e` | Playwright |
| `npm run db:setup` | Build the local test database |

## Test coverage today

**199 tests, all passing.**

- **112 unit** — Singapore date handling including the UTC-midnight boundary, deadline and on-time derivation, target and shortfall arithmetic, compliance percentages, all validation schemas, the Excel workbook (cell *types*, not just values), reminder scheduling and email content, and a guard proving the service-role key cannot reach the browser.
- **73 database** — the Row Level Security matrix executed against real PostgreSQL 16: cross-consultant isolation, privilege escalation, the 7-day edit window, deletion being impossible, submission-timing triggers, cancellation and restoration, insurer de-duplication, target history, reminder idempotency, and the Realtime publication.
- **14 end-to-end** — authentication and access control on mobile and desktop viewports.

## Key decisions

Full reasoning is in the Decision Register agreed during discovery. The ones that shape the code:

- **GR credits the month a case was submitted**, not incepted. Both dates are stored; a missing inception date shows as *Pending Inception* but still counts.
- **Targets are effective-dated.** The yearly figure is authoritative and the monthly target is yearly ÷ 12 unless an admin sets an override. Raising a target in June cannot rewrite May's shortfall.
- **Consultants may edit their own records for 7 days.** Admins are unrestricted, and every override is audit-logged.
- **Admins submit too.** They appear on the team board, receive reminders, and carry targets and compliance like anyone else.
- **Cases are never deleted.** Cancellation is soft, and there is no `DELETE` policy on `cases` for any role — the rule lives in Postgres, not in the UI.
- **Everyone submits every calendar day**, weekends and public holidays included. Anyone on leave will show low compliance; there is no leave workflow.

## Security posture

Row Level Security is the boundary, not the middleware. Every table has RLS **forced**, so policies bind the table owner too. Views are declared `security_invoker` — without that flag a view runs as its owner and becomes a complete RLS bypass.

Middleware and the server-side role checks in `src/lib/auth.ts` are defence in depth. If all of them were removed, a consultant still could not read another consultant's book.

See [`docs/security.md`](docs/security.md).

## Still required from the client

- Exact brand hex codes, or the logo file. Current values in `src/app/globals.css` are estimated from the supplied image; all colour is defined in that one file.
- Confirmation of the seeded insurer list in `supabase/migrations/0012_seed_insurers.sql`.
- Supabase project, Netlify site, Resend key with a verified sender domain, and the two admin accounts.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — how it fits together, and what is deliberately absent
- [`docs/database.md`](docs/database.md) — schema, triggers, views
- [`docs/security.md`](docs/security.md) — RLS model and threat notes
- [`docs/testing.md`](docs/testing.md) — how to run everything
- [`docs/netlify-deployment.md`](docs/netlify-deployment.md) — first deploy, env vars, rollback
- [`docs/reminder-function.md`](docs/reminder-function.md) — the two crons and how to test them before they run unattended
- [`docs/manual-test-checklist.md`](docs/manual-test-checklist.md) — the on-a-real-phone pass before launch
