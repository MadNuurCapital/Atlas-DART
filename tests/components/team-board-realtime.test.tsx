/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import type { TeamDailyRow } from "@/types/database";

/**
 * The team board refreshes itself when realtime says something changed.
 *
 * One person filling in their day is not one event: it is a daily_submissions
 * write plus one appointment_activities write per prospect row. Refreshing on
 * each of them fired a full server re-render ten or more times for a single
 * submission, and around the deadline - the exact moment an admin is watching
 * - the board spent its time re-fetching instead of painting.
 *
 * These tests hold that burst to one refresh, and hold the board still live.
 */

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin/daily",
  useSearchParams: () => new URLSearchParams(),
}));

/** Handlers the component registers, so the test can fire realtime events. */
const handlers: Array<() => void> = [];

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: () => {
      const chan = {
        on(_evt: string, _filter: unknown, cb: () => void) {
          handlers.push(cb);
          return chan;
        },
        subscribe(cb?: (s: string) => void) {
          cb?.("SUBSCRIBED");
          return chan;
        },
      };
      return chan;
    },
    removeChannel: vi.fn(),
  }),
}));

const row: TeamDailyRow = {
  user_id: "22222222-2222-4222-8222-222222222222",
  full_name: "Nur Aisyah",
  role: "consultant",
  business_date: "2026-03-10",
  submission_id: "33333333-3333-4333-8333-333333333333",
  status: "submitted",
  dials: 20,
  talked_to: 8,
  campaign_status: "running",
  in_office: true,
  appointments_opening: 2,
  appointments_closing: 1,
  appointments_follow_up: 0,
  appointments_nomination: 1,
  signed_cases: 1,
  active_gr: 4200,
  first_submitted_at: "2026-03-10T12:00:00Z",
  last_submitted_at: "2026-03-10T12:00:00Z",
  revision_count: 0,
  on_time: true,
};

async function mount() {
  const { TeamBoard } = await import("@/components/admin/team-board");
  return render(<TeamBoard initialRows={[row]} businessDate="2026-03-10" />);
}

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
  handlers.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the team board coalesces realtime refreshes", () => {
  it("turns one person's burst of writes into a single refresh", async () => {
    await mount();
    expect(handlers.length).toBeGreaterThan(0);

    // One submission: the day itself, then eight prospect rows.
    for (let i = 0; i < 9; i++) handlers[0]!();

    // Nothing yet - the board is still waiting for the burst to finish.
    expect(refresh).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("still refreshes for a single, isolated change", async () => {
    await mount();
    handlers[0]!();
    vi.advanceTimersByTime(1000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes again for a burst that arrives later", async () => {
    await mount();

    handlers[0]!();
    vi.advanceTimersByTime(1000);
    expect(refresh).toHaveBeenCalledTimes(1);

    // A second person submits a minute later - that is a separate refresh,
    // not one swallowed by the first.
    handlers[0]!();
    handlers[0]!();
    vi.advanceTimersByTime(1000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("proves the guard can fail: firing without waiting refreshes nothing", async () => {
    await mount();
    for (let i = 0; i < 5; i++) handlers[0]!();
    vi.advanceTimersByTime(100); // shorter than the quiet period
    expect(refresh).not.toHaveBeenCalled();
  });
});
