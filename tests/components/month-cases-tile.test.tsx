/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MonthCasesTile } from "@/components/dashboard/month-cases-tile";
import { MissedDaysNotice } from "@/components/dashboard/missed-days-notice";
import type { MonthCases, MissedDays } from "@/lib/dashboard-payload";

/**
 * Two tiles replacing the submission streak.
 *
 * The copy IS the feature here - a bare number motivates nobody, and the same
 * number means something different on the 3rd of the month than on the 25th.
 * So these assert the sentences rather than the data.
 */

const cases: MonthCases = {
  this_month: 0,
  best_start: 0,
  best_total: 0,
  last_month: 0,
  is_best_start: false,
  month_label: "June",
};

const showCases = (o: Partial<MonthCases>) =>
  render(<MonthCasesTile cases={{ ...cases, ...o }} />);

describe("cases this month", () => {
  it("does not scold somebody on the 1st of the month", async () => {
    showCases({ this_month: 0, last_month: 7 });

    // The 1st to the 5th of every month lands here. It must not read as a
    // rebuke, or the tile is demoralising a fifth of the time.
    expect(screen.getByText("No cases yet this month")).toBeTruthy();
    expect(screen.getByText(/7 last month\. The month is young/)).toBeTruthy();
  });

  it("is gentle with somebody who has never written one", async () => {
    showCases({ this_month: 0, last_month: 0 });
    expect(screen.getByText(/Your first one will show up here/)).toBeTruthy();
  });

  it("says how far ahead of the record they are", async () => {
    showCases({ this_month: 5, best_start: 3, is_best_start: true });
    expect(screen.getByText("5 cases this month")).toBeTruthy();
    expect(screen.getByText(/best start to a month yet — 2 ahead/)).toBeTruthy();
  });

  it("does not say 'ahead of 0' on a first-ever best", async () => {
    showCases({ this_month: 1, best_start: 0, is_best_start: true });
    expect(screen.getByText(/Your best start to a month yet\./)).toBeTruthy();
    expect(screen.queryByText(/ahead of/)).toBeNull();
  });

  it("names what it would take to beat the record", async () => {
    showCases({ this_month: 2, best_start: 4, is_best_start: false });
    // "2 more beats your best" is a target. "You are behind" is a verdict.
    expect(screen.getByText("2 cases this month")).toBeTruthy();
    expect(screen.getByText(/3 more beats your best start of 4/)).toBeTruthy();
  });

  it("gets the singular right", async () => {
    showCases({ this_month: 1, best_start: 5 });
    expect(screen.getByText("1 case this month")).toBeTruthy();
  });

  it("never mentions a colleague", async () => {
    const { container } = showCases({ this_month: 4, best_start: 2 });
    expect(container.textContent).not.toMatch(/team|rank|position|others/i);
  });
});

const missed: MissedDays = {
  ever_submitted: true,
  last_submitted: "2026-06-10",
  missed: 0,
  submitted_today: false,
};

const showMissed = (o: Partial<MissedDays>) =>
  render(<MissedDaysNotice missed={{ ...missed, ...o }} />);

describe("days without a submission", () => {
  it("renders nothing at all when somebody is up to date", async () => {
    const { container } = showMissed({ missed: 0 });

    // Not a green "0 days missed" tile. The dashboard should get QUIETER when
    // you are doing well, not busier.
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for somebody who has never submitted", async () => {
    const { container } = showMissed({ ever_submitted: false, missed: 0 });
    // A first day is not a lapse.
    expect(container.innerHTML).toBe("");
  });

  it("counts the days and offers the way back", async () => {
    showMissed({ missed: 3 });
    expect(screen.getByText("3 days without a submission")).toBeTruthy();
    expect(screen.getByText(/you can still fill them in/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Catch up" })).toBeTruthy();
  });

  it("gets the singular right", async () => {
    showMissed({ missed: 1 });
    expect(screen.getByText("1 day without a submission")).toBeTruthy();
  });

  it("warns once the edit window has been passed", async () => {
    showMissed({ missed: 12 });
    // Saves somebody discovering the seven-day limit the hard way, halfway
    // through typing a fortnight of catching up.
    expect(screen.getByText(/last seven are still editable/)).toBeTruthy();
    expect(screen.getByText(/older days need an admin/)).toBeTruthy();
  });
});
