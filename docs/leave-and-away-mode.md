# Leave & Away Mode

An advisor on holiday used to be chased five times a night for a DART they had
no intention of filling in, marked absent in red on the team board, and greeted
on their return with "You have missed 7 days".

They now declare the dates themselves. No approval, no manager, no balance
arithmetic.

```
Advisor schedules leave → the dates arrive → attendance reads Away
    → reminders pause → the dates pass → everything resumes by itself
```

## The one design decision everything else follows from

**Away Mode is read-only over the existing data model.**

It adds no logic to any write path. No trigger on `daily_submissions` or
`cases`, no change to either table's policies, no stored figure recalculated.
Away Mode only ever changes the answer to a question asked at read time.

Two things fall out of that:

- *"Away Mode must never block a legitimate submission"* is true by
  construction rather than by testing. A submission cannot be blocked by code
  that does not exist on its path.
- Rolling back is safe. `0035` can be reverted on its own and every function
  returns to its pre-leave body, with nobody's leave record dropped.

It is also the lesson of `0029`. A celebration trigger on `cases` took case
submission down in production, because an `AFTER INSERT` trigger that raises
rolls back the row that fired it. The way not to repeat that is to not be on
the write path at all. `tests/db/leave.test.ts` asserts no `%leave%` trigger
exists on either table.

## The table

`leave_periods`, from `0034`. Both dates **inclusive**, Singapore calendar —
the 5th to the 5th is one day away, not zero.

| Guarantee | How |
|---|---|
| No overlapping periods | `EXCLUDE USING gist` on `(user_id, daterange(…, '[]'))`, partial on `cancelled_at is null` |
| Coherent range | `check (ends_on >= starts_on)` |
| A mistyped year cannot silence somebody for a year | `check (ends_on - starts_on <= 180)` |
| "Other" means something | `check (reason <> 'other' or note is not null …)` |
| Finished leave is a record | `UPDATE` policy's `using` clause requires `ends_on >= sg_today()` |
| No record can be erased | **No `DELETE` policy and no `DELETE` grant**, admins included |
| Medical dates stay private | `SELECT` policy is own rows, or all rows for an admin |

### Why an exclusion constraint and not a check in the action

A trigger or server action that `SELECT`s for a conflicting period and then
refuses passes for two concurrent requests — both read, neither sees the other,
both insert. A double-tapped "Schedule leave" button is exactly that race. An
exclusion constraint is evaluated by the index and cannot be raced.

It earns its keep twice: `away_days()` counts away days by summing clamped
range intersections, which is only **exact** because a day cannot be covered
by two periods.

### Why cancelling is an UPDATE

`cancelled_at`, never a delete. The audit row recording a cancellation has to
have something left to point at, and "there is no record of it" says something
quite different from "it was cancelled on the 3rd".

## The two questions

Both in `0034`, so there is one definition of "away" rather than six subqueries
that drift apart.

```sql
public.is_away(p_user uuid, p_date date)            -- away on this date?
public.away_days(p_user uuid, p_from, p_to date)    -- away days in a window
```

Both are `SECURITY INVOKER`, stated rather than left to the default, so they
answer within the caller's own visibility:

- the reminder functions run as `service_role`, which bypasses RLS and so sees
  all fifteen people — which is what suppressing a push depends on
- an admin sees everyone
- an advisor sees themselves, and gets `false` for anybody else

## What changed, and why it is only six things

`0035`. Every one of these is a read.

| Function | Change |
|---|---|
| `missing_submissions` | `and not is_away(…)`. **This one line silences every reminder channel** |
| `team_daily` | `'away'` instead of `'missing'`, plus `away`, `away_until`, `leave_reason` |
| `monthly_compliance` | `required_days` less the days the person was away, plus `away_days` |
| `my_missed_days` | the gap, less away days within it, plus `away_days` and `away_now` |
| `app_bootstrap` | `away` and `nag_away` — at **zero extra round trips** |
| `admin_overview` | `away_now`, the roster |

### Why one line covers every reminder

Push, the 9 PM email and the agent's line in the 6 AM admin digest all reach
the team through `findMissing()` in `netlify/functions/lib/reminders.mts`,
which calls `missing_submissions()`. There is no second code path. The five
nightly push slots, the email and the digest were all fixed by the same
`not exists`.

Nothing is queued, either. Reminders are computed at send time from the live
missing list, so "re-check away status before sending" is not something that
had to be built — it is the only thing that can happen.

### Status precedence on the board

`submitted > away > draft > missing`

`submitted` outranks `away` deliberately: somebody who files a DART from their
hotel is credited for it and reads green. Away Mode removes an *obligation*,
not the work. The `away` boolean is returned alongside `status` so the board
can show both rather than having to choose.

`away` outranks `draft` because a half-filled form from somebody on leave is
not an outstanding obligation, and the board exists to show obligations.

### Two dates, not one

`app_bootstrap` returns both, and they are different questions:

- `nag_away` is about the date being **chased**, which between midnight and
  6 AM is *yesterday*. It decides whether to nag at all.
- `away` is about **today**, and draws the blue indicator.

At 1 AM the morning after leave ends these disagree, and both are right:
yesterday was an away day, today is not. One date cannot answer both.

### Forgive the denominator, never inflate the numerator

`monthly_compliance` removes away days from `required_days`. It does **not**
touch `submitted_days`, `on_time_days` or `late_days` — those still count only
real submissions. An advisor away for a whole month reads **0 of 0**, not
20 of 20, because they did not do twenty days of work.

The two clamps that were already in that function do the rest for free:
`least(…, 1)` stops somebody who submitted voluntarily reading 300%, and
`greatest(…, 0)` stops `missing_days` going negative.

`away_days` is surfaced on the admin compliance list and as an **Away Days**
column on the export's Submission Compliance sheet — appended, so anything
reading that sheet by column position keeps working. Without it, "18 required"
in a 22-day month is a number that cannot be reconciled against a calendar.

## There is no streak to protect

Atlas DART has no submission streak. `my_streaks()` was written and withdrawn
before it reached production; `0031` drops it and replaces it with monthly case
counts. The number that actually hurt a returning advisor was
`my_missed_days()`, and that is the one made leave-aware.

Case counts are deliberately **untouched**. Crediting leave days towards them
would manufacture production out of absence, which is precisely what the brief
forbids. A holiday makes the month quieter, not fuller.

## Performance

No new round trips. Everything rides a call the page already makes; `/leave`
itself is one plain `select` whose authorisation is the RLS policy.

Measured on 15 people, 450 submissions and 8 leave periods:

| | |
|---|---|
| `is_away` × 15 | 0.42 ms |
| `away_days` × 15 | 0.56 ms |
| `app_bootstrap` (every page) | 0.45–0.9 ms |
| `team_daily` | ~1 ms |
| `monthly_compliance` | ~3 ms |
| **One network round trip, US East ↔ Singapore** | **~330 ms** |

The whole feature's SQL costs under 1% of a single round trip. Indexes on
`leave_periods` are partial on `cancelled_at is null`, so cancelled rows are
excluded from the index and not merely from the query.

## Audit trail

Leave is self-declared with no approval, so the audit trail is the whole of the
accountability. `leave_created`, `leave_updated` and `leave_cancelled` are
written by the server actions through the existing `recordAudit()`, which uses
the caller's own client — so `actor_user_id` must equal `auth.uid()` and nobody
can attribute an action to anyone else.

**Backdating is allowed on purpose.** Somebody hospitalised last week has to be
able to put their record right. The leave dates say when they were away;
`created_at` and the audit row say when they told us, and backdating cannot
rewrite either. The form says out loud that the dates have passed and that the
change is recorded.

What backdating *does* change is `monthly_compliance`, because
`required_days` is computed live. No stored record moves — but a compliance
percentage that has already been looked at will read differently afterwards.
That is what "exclude Away days from eligible working-day calculations" means
in practice.

## Deliberately not built

- **No approval workflow.** Asked for explicitly: advisors schedule their own.
- **No notification when somebody books leave.** The team does not need
  announcing to; an admin looking at the overview will see the roster.
- **No reason on the admin roster.** A manager needs who is out and when they
  are back in order to plan. Self-declared medical leave is not something to
  publish on a dashboard anybody can walk past in order to answer that. The
  reason is on the daily board, read one row at a time.
- **No half days, no leave balances, no public-holiday calendar.** The brief
  said not to overcomplicate it, and every calendar day already counts in this
  app — see the compliance tile.
- **Not in the bottom navigation.** It already carries five items, which is as
  many as fit on a phone. The dashboard card is the way in on mobile, the same
  route `/coaching` takes.

## Still flowing during leave

Team celebrations ("Congratulations Faisal!") and coaching-session reminders
are **not** suppressed. Neither is a demand on the away person: a celebration
is somebody else's good news, and a coaching session booked during your leave
is a real meeting you would want reminding about.

If that should change, it is one extra condition in
`src/lib/push/team.ts` — the device list would need the away users removed.

## Tests

- `tests/db/leave.test.ts` — 45 tests against real Postgres: the constraints,
  reminder suppression, the board, compliance, missed days, month/year/leap-day
  boundaries, permissions, and the no-trigger guarantee.
- `tests/components/leave.test.tsx` — the colours. An away advisor must never
  render as a problem, and the summary tile must agree with the badge.
- `tests/unit/nag.test.ts` — the in-app banner is silent at every hour of the
  chase while away, and unchanged for everybody else.

Two of these exist because of specific bugs found while building the feature,
both verified by mutation:

1. `StatusBadge` fell through to the `on_time` branch, and `on_time` is null
   for anyone who has not submitted — so an advisor on declared medical leave
   rendered as **"Late"**.
2. The board's "Missing" total counted away people, so the row read blue while
   the tile above it still told an admin four people had failed to submit —
   and an admin believes the tile.
