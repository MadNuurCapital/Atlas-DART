/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MyCoaching } from "@/components/coaching/coaching-card";

const acknowledgeCoaching = vi.fn();
const requestCoaching = vi.fn();

vi.mock("@/app/(app)/coaching/actions", () => ({
  acknowledgeCoaching: (fd: FormData) => acknowledgeCoaching(fd),
  requestCoaching: (fd: FormData) => requestCoaching(fd),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const { CoachingCard } = await import("@/components/coaching/coaching-card");

/** 10am Singapore on 5 August 2026. */
const NOW = new Date("2026-08-05T02:00:00Z");

function session(overrides: Partial<MyCoaching> = {}): MyCoaching {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Monthly review",
    category: "monthly_review",
    message: "Please be reminded that you have an upcoming coaching session.",
    location: "Office meeting room",
    requested_topic: null,
    agenda: null,
    scheduled_at: "2026-08-07T06:00:00Z", // 2pm Singapore, two days away
    status: "scheduled",
    acknowledged_at: null,
    cancellation_reason: null,
    coach_name: "Director",
    ...overrides,
  };
}

beforeEach(() => {
  acknowledgeCoaching.mockReset().mockResolvedValue({ ok: true });
  requestCoaching.mockReset().mockResolvedValue({ ok: true });
});

describe("a consultant's coaching card", () => {
  it("shows the next session with its time in Singapore", () => {
    render(<CoachingCard sessions={[session()]} now={NOW} />);

    expect(screen.getByText("Monthly review")).toBeInTheDocument();
    // 2pm Singapore, not 6am UTC.
    expect(screen.getByText(/Friday at 2:00 pm/i)).toBeInTheDocument();
  });

  it("names the coach and where to meet", () => {
    render(<CoachingCard sessions={[session()]} now={NOW} />);

    expect(screen.getByText("Director")).toBeInTheDocument();
    expect(screen.getByText("Office meeting room")).toBeInTheDocument();
  });

  it("gets louder as the session approaches", () => {
    const { rerender } = render(
      <CoachingCard
        sessions={[session({ scheduled_at: "2026-09-10T06:00:00Z" })]}
        now={NOW}
      />,
    );
    expect(screen.getByTestId("coaching-card")).toHaveAttribute(
      "data-urgency",
      "far",
    );

    rerender(
      <CoachingCard
        sessions={[session({ scheduled_at: "2026-08-07T06:00:00Z" })]}
        now={NOW}
      />,
    );
    expect(screen.getByTestId("coaching-card")).toHaveAttribute(
      "data-urgency",
      "near",
    );

    rerender(
      <CoachingCard
        sessions={[session({ scheduled_at: "2026-08-05T06:00:00Z" })]}
        now={NOW}
      />,
    );
    expect(screen.getByTestId("coaching-card")).toHaveAttribute(
      "data-urgency",
      "today",
    );
  });

  it("puts the nearest session first and the rest beneath", () => {
    render(
      <CoachingCard
        sessions={[
          session({ id: "later", scheduled_at: "2026-08-20T06:00:00Z" }),
          session({
            id: "sooner",
            title: "Closing practice",
            scheduled_at: "2026-08-06T06:00:00Z",
          }),
        ]}
        now={NOW}
      />,
    );

    // The full card is the sooner one, not whichever arrived first.
    expect(screen.getByTestId("coaching-card")).toHaveTextContent(
      "Closing practice",
    );
    expect(screen.getAllByTestId("coaching-compact")).toHaveLength(1);
  });

  it("lets them acknowledge, and says so once done", async () => {
    const user = userEvent.setup();
    render(<CoachingCard sessions={[session()]} now={NOW} />);

    await user.click(screen.getByTestId("acknowledge-coaching"));
    await waitFor(() => expect(acknowledgeCoaching).toHaveBeenCalledTimes(1));

    const sent = acknowledgeCoaching.mock.calls[0]![0] as FormData;
    expect(sent.get("sessionId")).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it("stops asking once acknowledged", () => {
    render(
      <CoachingCard
        sessions={[session({ acknowledged_at: "2026-08-05T01:00:00Z" })]}
        now={NOW}
      />,
    );

    expect(screen.queryByTestId("acknowledge-coaching")).not.toBeInTheDocument();
    expect(screen.getByText(/You have confirmed this/i)).toBeInTheDocument();
  });

  it("shows an agenda when there is one", () => {
    render(
      <CoachingCard
        sessions={[session({ agenda: "Pipeline and Q3 targets" })]}
        now={NOW}
      />,
    );
    expect(screen.getByText("Pipeline and Q3 targets")).toBeInTheDocument();
  });

  it("offers to ask for coaching when nothing is booked", () => {
    render(<CoachingCard sessions={[]} now={NOW} />);

    expect(screen.getByText("No coaching booked")).toBeInTheDocument();
    expect(screen.getByTestId("request-coaching")).toBeInTheDocument();
  });

  it("sends a request", async () => {
    const user = userEvent.setup();
    render(<CoachingCard sessions={[]} now={NOW} />);

    await user.click(screen.getByTestId("request-coaching"));
    await user.type(
      screen.getByLabelText(/What would you like coached/i),
      "Closing CIS cases",
    );
    await user.click(screen.getByTestId("send-coaching-request"));

    await waitFor(() => expect(requestCoaching).toHaveBeenCalledTimes(1));
    const sent = requestCoaching.mock.calls[0]![0] as FormData;
    expect(sent.get("topic")).toBe("Closing CIS cases");
  });

  it("shows a pending request while it waits", () => {
    render(
      <CoachingCard
        sessions={[
          session({
            status: "requested",
            scheduled_at: null,
            requested_topic: "Help with objections",
          }),
        ]}
        now={NOW}
      />,
    );

    expect(screen.getByText("Coaching requested")).toBeInTheDocument();
    expect(screen.getByText("Help with objections")).toBeInTheDocument();
    // Nothing to acknowledge yet.
    expect(screen.queryByTestId("acknowledge-coaching")).not.toBeInTheDocument();
  });

  it("explains a cancellation rather than just losing the card", () => {
    render(
      <CoachingCard
        sessions={[
          session({
            status: "cancelled",
            cancellation_reason: "Clashes with the team meeting",
          }),
        ]}
        now={NOW}
      />,
    );

    expect(screen.getByText("Coaching cancelled")).toBeInTheDocument();
    expect(
      screen.getByText("Clashes with the team meeting"),
    ).toBeInTheDocument();
  });

  it("says when a request was declined, and why", () => {
    render(
      <CoachingCard
        sessions={[
          session({
            status: "declined",
            scheduled_at: null,
            cancellation_reason: "Covered in last week's team session",
          }),
        ]}
        now={NOW}
      />,
    );

    expect(screen.getByText("Coaching request declined")).toBeInTheDocument();
  });

  it("never renders a completed session as upcoming", () => {
    // The database does not send these to a consultant at all, but the card
    // must not treat one as live if it ever arrived.
    render(
      <CoachingCard
        sessions={[session({ status: "completed" })]}
        now={NOW}
      />,
    );

    expect(screen.queryByTestId("coaching-card")).not.toBeInTheDocument();
    expect(screen.getByText("No coaching booked")).toBeInTheDocument();
  });
});
