# Manual test checklist

Run this on a **real phone**, not a desktop browser resized. Tick everything before letting the team near it.

Automated tests cover the rules; this checklist covers the things only a person can judge — whether it is fast, legible in sunlight, and obvious.

## Setup

- [ ] Two admin accounts exist, created individually. No shared password.
- [ ] At least two consultant accounts exist.
- [ ] A yearly target is set for at least one person, and deliberately not for another.

## Sign in

- [ ] Visiting any page while signed out lands on `/login`.
- [ ] After signing in you arrive at the page you originally asked for.
- [ ] A wrong password says "Those details did not match" — it must **not** reveal whether the email exists.
- [ ] A consultant visiting `/admin` is bounced to `/dashboard`.

## Daily submission — the two-minute test

Time yourself.

- [ ] `/today` opens on today's Singapore date.
- [ ] Numeric fields open the **numeric keypad**, not the full keyboard.
- [ ] The page does not zoom when a field is focused (iOS).
- [ ] Office toggle turns the dot green and red.
- [ ] Save Draft works; the badge reads "Draft — not submitted".
- [ ] Refreshing recovers the draft.
- [ ] Submit shows a confirmation summarising what is about to be sent.
- [ ] **Under two minutes from opening to submitted.** If not, say so — that is a real failure.

### The awkward cases

- [ ] All zeros submits successfully. A quiet day is a valid day.
- [ ] Clearing a required field and submitting shows a field error, not a crash.
- [ ] **Double-tap Submit rapidly.** One submission, revision count stays 0.
- [ ] Change a figure and resubmit: revision count becomes 1, **first submitted time is unchanged**.
- [ ] Resubmit without changing anything: revision count stays where it was.
- [ ] Navigate back 7 days — still editable.
- [ ] Navigate back 8 days — read-only, with the reason stated.
- [ ] No forward arrow on today. You cannot submit tomorrow.

## Appointments

- [ ] Adding an appointment moves the right AO/AC/FU/N tile.
- [ ] Changing the type moves the count from one tile to the other.
- [ ] Removing one drops the count.
- [ ] A blank prospect name is rejected.
- [ ] Adding an appointment on a day with nothing else recorded does **not** mark that day submitted.

## Cases

- [ ] Add a case; GR appears on the dashboard against target.
- [ ] Leave the inception date blank — it shows as "Pending inception" and still counts.
- [ ] An inception date before the submitted date is rejected.
- [ ] Search by client, insurer and policy all work.
- [ ] Month filter works.
- [ ] Cancel without a reason is rejected.
- [ ] Cancel with a reason: GR drops immediately, the row moves to the Cancelled tab with its reason, GR is struck through.
- [ ] A consultant sees no Restore button. An admin does, and it works.
- [ ] Add an insurer inline from the case form.
- [ ] Add one that already exists in different capitalisation or spacing — it should quietly use the existing one, not create a duplicate.

## Targets

- [ ] Set a yearly target; every month shows a twelfth of it.
- [ ] Override one month; only that month changes.
- [ ] Remove the override; it reverts to the twelfth.
- [ ] Someone with no target reads **"No target set"**, not "$0" and not "0%".
- [ ] Exceed a target: shortfall reads 0, achievement over 100%, nothing negative.
- [ ] Change a target and confirm an audit row exists with the old and new value.

## Admin board — the realtime test

Two devices, or two browsers.

- [ ] Open `/admin/daily` as an admin.
- [ ] Submit as a consultant on the other device.
- [ ] **The board updates without touching it.** The Live indicator is showing.
- [ ] Missing people appear as rows saying "Missing", not as absent rows.
- [ ] Office dots read correctly: green, red, grey for no submission.
- [ ] Late submissions show as Late.
- [ ] Search by name works.
- [ ] On a phone it is cards, not a squashed table, and there is **no horizontal scrolling**.

## Export

- [ ] Download the monthly report.
- [ ] Six sheets, correctly named.
- [ ] Currency cells are **numbers** — click one and Excel shows a number in the formula bar, not text.
- [ ] Percentages read sensibly (15.0%, not 1500.5%).
- [ ] Submission times are Singapore time, not UTC eight hours earlier.
- [ ] Cancelled cases appear with reason and cancelled date.
- [ ] A blank cell, not a zero, where someone has no target.
- [ ] **Reconcile by hand:** total the Active GR column and compare it with the dashboard for the same month. They must match exactly.
- [ ] Export for a single consultant contains only that person.
- [ ] Export a month with no data — six sheets, headers only, no crash.

## Reminders

Do this with `dryRun=true` first.

- [ ] Dry run lists exactly who you expect.
- [ ] Real run: a missing consultant receives one email; the greeting uses their first name and the date is correct.
- [ ] Someone who submitted receives nothing.
- [ ] Someone with only a draft **does** receive one.
- [ ] Admins receive the digest listing everyone missing.
- [ ] Run it twice — no second email, and `reminder_logs` still has one row per person.
- [ ] A deactivated leaver receives nothing.

## People and the audit trail

- [ ] Invite someone; they receive an email and can set their own password.
- [ ] If email is not configured yet, the temporary password is shown **and can be copied** — closing that dialog must not be the only chance to read it.
- [ ] Inviting an email that already exists is refused, naming who has it.
- [ ] Promote a consultant to admin; they gain the Management section.
- [ ] Try to demote or deactivate the **last** active admin — it must be refused.
- [ ] Deactivate a leaver: they vanish from the team board and reminders, but their past GR and submissions are untouched in reports.
- [ ] Open `/admin/audit`. Every change you made above appears, with who and when.
- [ ] A target change shows the old value and the new one, formatted as money.
- [ ] Filter by action works.

## Accessibility and field conditions

- [ ] Readable outdoors at full brightness.
- [ ] Every tap target comfortable one-handed.
- [ ] Works one-handed on a small phone.
- [ ] Tab order is sensible on desktop.
- [ ] Buttons announce themselves usefully to a screen reader.

## Sign-off

- [ ] Tested by: ______________  Date: __________
- [ ] Approved for the team by: ______________  Date: __________

Anything that fails goes back as a bug, not as a note. A checklist with unticked boxes is not a passed checklist.
