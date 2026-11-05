/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { LeavePeriod, TeamDailyRow } from "@/types/database";
import { sgToday, addDays } from "@/lib/sg-date";

/**
 * Leave & Away Mode in the interface.
 *
 * Two things are worth testing at this level, and they are both colours in
 * disguise:
 *
 *   1. An away advisor must never be rendered as a problem. The attendance
 *      badge fell straight through to the on_time branch before this feature,
 *      and on_time is null for anyone who has not submitted - so somebody on
 *      declared medical leave would have been labelled "Late".
 *
 *   2. The tile above that badge must agree with it. Counting away people in
 *      the "Missing" total was the quiet version of the same bug: the row
 *      reads blue while the summary still tells an admin four people failed
 *      to submit, and the admin believes the summary.
 */

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/leave",
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: () => ({
      on() {
        return this;
      },
      subscribe() {
        return this;
      },
    }),
    removeChannel: vi.fn(),
  }),
}));

vi.mock("@/app/(app)/leave/actions", () => ({
  scheduleLeave: vi.fn(),
  updateLeave: vi.fn(),
  cancelLeave: vi.fn(),
}));

const { TeamBoard } = await import("@/components/admin/team-board");
const { LeaveManager } = await import("@/components/leave/leave-manager");
const { AwayBanner } = await import("@/components/leave/away-banner");
const { AwayRoster } = await import("@/components/admin/away-roster");
const { LeaveTile } = await import("@/components/dashboard/leave-tile");
const { MissedDaysNotice } = await import(
  "@/components/dashboard/missed-days-notice"
);

const BASE: TeamDailyRow = {
  user_id: "11111111-1111-4111-8111-111111111111",
  full_name: "Nur Aisyah",
  role: "consultant",
  business_date: "2026-06-12",
  submission_id: null,
  status: "missing",
  dials: null,
  talked_to: null,
  campaign_status: null,
  in_office: null,
  appointments_opening: null,
  appointments_closing: null,
  appointments_follow_up: null,
  appointments_nomination: null,
  signed_cases: null,
  active_gr: null,
  first_submitted_at: null,
  last_submitted_at: null,
  revision_count: null,
  on_time: null,
  away: false,
  away_until: null,
  leave_reason: null,
};

function row(over: Partial<TeamDailyRow>): TeamDailyRow {
  return { ...BASE, ...over };
}

const AWAY = row({
  user_id: "22222222-2222-4222-8222-222222222222",
  full_name: "Faisal Rahman",
  status: "away",
  away: true,
  away_until: "2026-06-20",
  leave_reason: "medical",
});

describe("an away advisor is never rendered as a problem", () => {
  it("shows Away rather than Late", () => {
    const { container } = render(
      <TeamBoard initialRows={[AWAY]} businessDate="2026-06-12" />,
    );

    // Scoped to the advisor's own table row. The summary tiles above carry a
    // permanent "Late" label of their own, so asserting over the whole
    // container would pass for the wrong reason.
    const bodyRow = container.querySelector("tbody tr");
    expect(bodyRow?.textContent).toContain("Away");
    // on_time is null for somebody who has not submitted, so before the away
    // branch existed this row rendered them as Late.
    expect(bodyRow?.textContent).not.toContain("Late");
    expect(bodyRow?.textContent).not.toContain("Missing");
  });

  it("keeps them out of the Missing total", () => {
    const { container } = render(
      <TeamBoard
        initialRows={[
          AWAY,
          row({ user_id: "a", full_name: "A Missing", status: "missing" }),
          row({
            user_id: "b",
            full_name: "B Submitted",
            status: "submitted",
            on_time: true,
          }),
        ]}
        businessDate="2026-06-12"
      />,
    );

    const text = container.textContent ?? "";
    // One missing, one away, one submitted. If away were counted as missing
    // this would read 2, and the admin would chase somebody on a plane.
    expect(text).toMatch(/1\s*Missing/);
    expect(text).toMatch(/1\s*Away/);
    expect(text).toMatch(/1\s*Submitted/);
  });

  it("offers no Away tile when nobody is away", () => {
    const { container } = render(
      <TeamBoard
        initialRows={[row({ status: "submitted", on_time: true })]}
        businessDate="2026-06-12"
      />,
    );
    // A permanent "Away 0" is a standing reminder of a thing that is usually
    // not happening.
    expect(container.textContent).not.toMatch(/Away/);
  });

  it("credits a DART submitted while away, and still marks them away", () => {
    const { container } = render(
      <TeamBoard
        initialRows={[
          row({
            status: "submitted",
            on_time: true,
            away: true,
            away_until: "2026-06-20",
          }),
        ]}
        businessDate="2026-06-12"
      />,
    );

    // Away Mode removes an obligation, not the work.
    expect(container.textContent).toContain("On time");
    expect(container.textContent).toMatch(/1\s*Away/);
    // ...and not counted as missing, despite the away flag being set.
    expect(container.textContent).toMatch(/0\s*Missing/);
  });
});

describe("the away indicator", () => {
  it("names the return date rather than only the last day", () => {
    const { container } = render(
      <AwayBanner
        leave={{
          starts_on: "2026-06-10",
          ends_on: "2026-06-20",
          reason: "holiday",
        }}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Away Mode is on");
    expect(text).toContain("Holiday / Overseas");
    // Back the day AFTER the last away day, because both ends are inclusive.
    expect(text).toMatch(/21 Jun/);
  });

  it("says reminders resume tomorrow on the last day", () => {
    const today = sgToday();
    const { container } = render(
      <AwayBanner
        leave={{ starts_on: today, ends_on: today, reason: "personal" }}
      />,
    );
    // "Until today" reads as though it has already ended; what is useful on
    // the last day is when normal service comes back.
    expect(container.textContent).toContain("Last day");
  });
});

describe("the dashboard tile", () => {
  it("offers the feature quietly when no leave is booked", () => {
    const { container } = render(<LeaveTile leave={null} />);
    expect(container.textContent).toContain("Schedule leave");
    expect(container.textContent).not.toContain("Away Mode is on");
  });

  it("distinguishes active leave from leave that is merely booked", () => {
    const active = render(
      <LeaveTile
        leave={{
          id: "1",
          starts_on: "2026-06-10",
          ends_on: "2026-06-20",
          reason: "holiday",
          active: true,
        }}
      />,
    );
    expect(active.container.textContent).toContain("Away Mode is on");

    const upcoming = render(
      <LeaveTile
        leave={{
          id: "2",
          starts_on: "2026-09-10",
          ends_on: "2026-09-20",
          reason: "holiday",
          active: false,
        }}
      />,
    );
    expect(upcoming.container.textContent).toContain("Leave coming up");
  });
});

describe("the missed-days notice", () => {
  const base = {
    ever_submitted: true,
    last_submitted: "2026-06-04",
    submitted_today: false,
  };

  it("says nothing when the whole gap was leave", () => {
    // The number the feature was asked for. missed already has away days
    // subtracted, so a week's holiday leaves nothing to say.
    const { container } = render(
      <MissedDaysNotice
        missed={{ ...base, missed: 0, away_days: 7, away_now: false }}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("stays quiet while somebody is still away", () => {
    const { container } = render(
      <MissedDaysNotice
        missed={{ ...base, missed: 3, away_days: 0, away_now: true }}
      />,
    );
    // The gap is real, but "Catch up" is not a reasonable thing to put in
    // front of somebody on medical leave today.
    expect(container.textContent).toBe("");
  });

  it("still speaks up for a real gap when nobody is away", () => {
    const { container } = render(
      <MissedDaysNotice
        missed={{ ...base, missed: 3, away_days: 0, away_now: false }}
      />,
    );
    expect(container.textContent).toContain("3 days without a submission");
  });
});

describe("the admin roster", () => {
  it("renders nothing when nobody is away", () => {
    const { container } = render(<AwayRoster rows={[]} />);
    expect(container.textContent).toBe("");
  });

  it("gives a name, a start and a return, and no reason", () => {
    const { container } = render(
      <AwayRoster
        rows={[
          {
            user_id: "1",
            full_name: "Faisal Rahman",
            starts_on: "2026-06-10",
            ends_on: "2026-06-20",
          },
        ]}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Faisal Rahman");
    expect(text).toMatch(/21 Jun/);
    // Self-declared medical leave is not something to publish on a dashboard
    // anybody can walk past.
    expect(text).not.toMatch(/medical|holiday|personal/i);
  });
});

describe("the leave manager", () => {
  const today = sgToday();

  function period(over: Partial<LeavePeriod>): LeavePeriod {
    return {
      id: "p1",
      user_id: "u1",
      starts_on: today,
      ends_on: today,
      reason: "holiday",
      note: null,
      cancelled_at: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      ...over,
    };
  }

  it("invites somebody to use it when they have no leave", () => {
    const { container } = render(<LeaveManager periods={[]} />);
    expect(container.textContent).toContain("No leave scheduled");
  });

  it("sorts periods into now, coming up and previously", () => {
    const { container } = render(
      <LeaveManager
        periods={[
          period({ id: "now", starts_on: today, ends_on: addDays(today, 3) }),
          period({
            id: "soon",
            starts_on: addDays(today, 30),
            ends_on: addDays(today, 34),
            reason: "medical",
          }),
          period({
            id: "past",
            starts_on: addDays(today, -40),
            ends_on: addDays(today, -35),
            reason: "personal",
          }),
        ]}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Away now");
    expect(text).toContain("Coming up");
    expect(text).toContain("Previously");
  });

  it("offers no controls on leave that has finished", () => {
    const { container } = render(
      <LeaveManager
        periods={[
          period({
            id: "past",
            starts_on: addDays(today, -40),
            ends_on: addDays(today, -35),
          }),
        ]}
      />,
    );
    // The database refuses to update a finished period, so offering an Edit
    // button would be offering a control that cannot work.
    expect(container.textContent).not.toContain("Edit");
  });

  it("counts a single-day period as one day, not zero", () => {
    const { container } = render(
      <LeaveManager periods={[period({ starts_on: today, ends_on: today })]} />,
    );
    expect(container.textContent).toContain("1 day");
  });
});
