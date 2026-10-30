/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

/**
 * A colleague's win arrives wherever you are. Your own does not.
 *
 * The advisor who just submitted has closed a congratulations dialog naming
 * their client, the policy type and what the case did to their month. A second,
 * thinner celebration arriving behind it would read as the app being pleased
 * with itself rather than pleased for them.
 *
 * The filter is on actor_id rather than on anything in the message, because
 * the row is the only part of this that can be trusted to say who did it.
 */

const ME = "11111111-1111-4111-8111-111111111111";
const COLLEAGUE = "22222222-2222-4222-8222-222222222222";

const refresh = vi.fn();
const success = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/today",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("sonner", () => ({
  toast: { success, error: vi.fn(), warning: vi.fn() },
}));

/** Handlers the component registers, so the test can deliver events. */
const handlers: Array<(payload: unknown) => void> = [];

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    const chan = {
      on(_evt: string, _filter: unknown, cb: (payload: unknown) => void) {
        handlers.push(cb);
        return chan;
      },
      subscribe() {
        return chan;
      },
    };
    return { channel: () => chan, removeChannel: vi.fn() };
  },
}));

async function mount() {
  const { TeamCelebrations } = await import(
    "@/components/notifications/team-celebrations"
  );
  return render(<TeamCelebrations myId={ME} />);
}

function deliver(actorId: string, actorName: string, id = "event-1") {
  for (const handler of handlers) {
    handler({ new: { id, actor_id: actorId, actor_name: actorName } });
  }
}

beforeEach(() => {
  handlers.length = 0;
  refresh.mockReset();
  success.mockReset();
});

describe("team celebrations", () => {
  it("celebrates a colleague's case, naming them", async () => {
    await mount();
    deliver(COLLEAGUE, "Zul Advisor");

    expect(success).toHaveBeenCalledTimes(1);
    expect(success.mock.calls[0]![0]).toBe("Zul Advisor just submitted a case!");
  });

  it("says nothing to the person who submitted it", async () => {
    await mount();
    deliver(ME, "My Own Name");

    // They have just closed the congratulations dialog. Twice is once too many.
    expect(success).not.toHaveBeenCalled();
  });

  it("still celebrates a colleague after one of your own", async () => {
    await mount();
    deliver(ME, "My Own Name", "mine");
    deliver(COLLEAGUE, "Zul Advisor", "theirs");

    // The filter must skip the event, not stop listening.
    expect(success).toHaveBeenCalledTimes(1);
    expect(success.mock.calls[0]![0]).toBe("Zul Advisor just submitted a case!");
  });

  it("keys the toast by event id, so a redelivery replaces rather than stacks", async () => {
    await mount();
    deliver(COLLEAGUE, "Zul Advisor", "event-7");

    expect(success.mock.calls[0]![1]).toMatchObject({ id: "event-7" });
  });

  it("refreshes so the bell and the feed catch up", async () => {
    await mount();
    deliver(COLLEAGUE, "Zul Advisor");

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh for your own case either", async () => {
    await mount();
    deliver(ME, "My Own Name");

    // Nothing changed for them that the dialog has not already handled, and a
    // refresh here would re-render the page underneath an open dialog.
    expect(refresh).not.toHaveBeenCalled();
  });

  it("renders nothing of its own", async () => {
    const { container } = await mount();
    expect(container.innerHTML).toBe("");
  });
});
