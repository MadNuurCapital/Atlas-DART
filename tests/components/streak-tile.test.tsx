/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StreakTile } from "@/components/dashboard/streak-tile";
import type { Streaks } from "@/lib/dashboard-payload";

/**
 * The streak tile says a different thing in each state, because "3 days" means
 * something different on the day you are about to lose it than on the day you
 * set a record.
 *
 * These assert the copy, which is the whole feature - the number alone
 * motivates nobody.
 */

const base: Streaks = {
  current: 0,
  longest: 0,
  submitted_today: false,
  total_days: 0,
};

const show = (s: Partial<Streaks>) =>
  render(<StreakTile streaks={{ ...base, ...s }} />);

describe("the streak tile", () => {
  it("invites somebody with no history to start", async () => {
    show({});
    expect(screen.getByText("Start a streak")).toBeTruthy();
    expect(screen.getByText(/Submit today and you are on one/)).toBeTruthy();
  });

  it("counts a live streak and names the day it needs", async () => {
    show({ current: 3, longest: 7, submitted_today: false });
    expect(screen.getByText("3 days in a row")).toBeTruthy();
    expect(screen.getByText(/Submit today to keep it going/)).toBeTruthy();
    expect(screen.getByText(/Your best is 7/)).toBeTruthy();
  });

  it("stops nagging once today is in", async () => {
    show({ current: 3, longest: 7, submitted_today: true });
    // Telling somebody to submit when they already have is how an app teaches
    // people to stop reading it.
    expect(screen.queryByText(/Submit today/)).toBeNull();
    expect(screen.getByText(/Your best is 7/)).toBeTruthy();
  });

  it("says so when the run is a personal best", async () => {
    show({ current: 7, longest: 7, submitted_today: true });
    expect(screen.getByText("7 days — your best yet")).toBeTruthy();
    expect(screen.getByText(/new record/)).toBeTruthy();
  });

  it("is encouraging rather than accusing about a broken streak", async () => {
    show({ current: 0, longest: 12, submitted_today: false });
    expect(screen.getByText("Streak broken")).toBeTruthy();
    expect(screen.getByText(/Your best run was 12 days/)).toBeTruthy();
    expect(screen.getByText(/start again/)).toBeTruthy();
  });

  it("gets the singular right on day one", async () => {
    show({ current: 1, longest: 1, submitted_today: true });
    expect(screen.getByText("1 day in a row")).toBeTruthy();
  });

  it("never mentions anybody else", async () => {
    const { container } = show({ current: 5, longest: 9 });
    // The comparison on offer is with your own best run - a comparison
    // everybody can win. No ranking, no colleagues, no team position.
    expect(container.textContent).not.toMatch(/team|rank|position|others/i);
  });
});
