# Private coaching

One-to-one coaching booked by an admin for one person. Only that person sees
it. Added after the rest of the app was already live; nothing about DART, cases,
GR, targets or authentication changed to accommodate it.

## Who can do what

There are still only two roles. No new role was added, `is_admin()` is
unchanged, and no existing policy was touched.

| | Consultant | Admin |
|---|---|---|
| Book a session | No | Yes, for anyone active |
| Request coaching for themselves | Yes | Yes |
| See own upcoming and own pending request | Yes | Yes |
| See own completed or missed history | **No** | Yes, everyone's |
| See anyone else's coaching | **Never** | Yes |
| Acknowledge | Own only | Own only |
| Edit, reschedule, cancel, decline, complete, reopen | No | Yes |
| Read internal or outcome notes | **Never** | Yes |

Both admins see everything, including requests. That is deliberate: a request
made while one admin is away still reaches the other, and nothing is orphaned
if an admin account is later deactivated.

## The shape of a session

```
Consultant requests ──► requested (no time yet)
                            │
             admin schedules │ admin declines (reason required)
                            ▼                    ▼
Admin books ────────► scheduled              declined
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
    completed            missed             cancelled
   (reopenable)     (set by hand)      (reason required)
```

`declined` is kept apart from `cancelled` so that saying no to a request does
not read in the reports as calling off a meeting that was arranged.

## Privacy, and why the notes are a separate table

Row Level Security grants or denies whole **rows**. A consultant allowed to read
their own coaching session is allowed to read every column of it — there is no
policy that says "this row, but not those two fields". Column privileges cannot
help either, because both roles connect to Postgres as the same `authenticated`
role, so revoking a column from a consultant would revoke it from an admin too.

So `internal_notes` and `outcome_notes` live in `coaching_notes`, a table whose
every policy requires `is_admin()`. A consultant querying it directly, with
their own token, gets **zero rows** — not a filtered column.

What a consultant can see of their own coaching is enforced the same way, in the
policy rather than in a page:

- `requested` and `scheduled` — yes
- `cancelled` and `declined` — for 7 days, so nobody waits for a meeting that is
  off, then it disappears
- `completed` and `missed` — never

## Reminders

Four notifications, all push, all reusing the machinery already running for the
nightly DART chase.

| When | Sent by |
|---|---|
| The moment it is booked | The server action |
| Evening before, 7:00 PM SGT | `coaching-reminders` (`0 11 * * *` UTC) |
| Morning of, 8:00 AM SGT | `coaching-reminders` (`0 0 * * *` UTC) |
| On cancellation or a change of time | The server action |

Twice a day rather than hourly. Unlike a missing DART, coaching is not something
the person is failing to do, so nagging would be the wrong shape entirely.

`coaching_reminders_sent` is keyed on `(session_id, kind)` rather than on a
date. Two sessions on one day — a review at 10am and an ad-hoc at 4pm — would
otherwise collide in `reminder_logs` and the second would silently never be
sent. The existing reminder table was left alone rather than having its unique
key widened.

## Rescheduling

Moving the time **clears the acknowledgement** and sends a fresh notification.
Someone who confirmed a Friday 2pm has confirmed a meeting that no longer
exists, and leaving the tick in place would tell an admin they had seen a change
they were never shown.

This is a database trigger, not something the server action remembers to do, so
it holds however the row is written.

## Booking several at once

The create form takes one date and category, then a list of people each with
their own time — twenty monthly reviews on one afternoon is the case it exists
for. Each session is an independent row once created: editing, rescheduling or
cancelling one does not touch the others. There is no recurrence and no cap on
how many can be booked.

## Migrations

| File | Contents |
|---|---|
| `0018_coaching_sessions.sql` | The table, its constraints, the reschedule and column-guard triggers, RLS, realtime |
| `0019_coaching_notes.sql` | Admin-only notes |
| `0020_coaching_reminders_sent.sql` | Notification bookkeeping, keyed by session |

All forward-only and re-runnable, like every migration before them.

## Export

A seventh worksheet, **Coaching**: date, time, consultant, coach, category,
title, status, acknowledgement and location. Dates are real date cells in
Singapore wall-clock time, as everywhere else in the workbook.

Internal and outcome notes are deliberately **not** in the export. They are
admin-only in the database, and a spreadsheet gets forwarded, printed and left
on desks.

## Testing

```bash
npm run test:db      # RLS matrix, including the privacy guarantees
npm run test         # SG time conversion, export sheet
npm run test:components
```

The database tests are the ones that matter here. They act as a real consultant
against real Postgres and assert that another person's session, their own
history, and every note row are all unreachable.

## Rollback

The feature is additive. Reverting the commit removes the routes, the card and
the scheduled function; the three tables are simply unused and hold no DART,
case or GR data. No existing migration was modified, so there is nothing to
unwind.
