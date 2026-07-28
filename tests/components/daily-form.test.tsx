/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DailySubmission } from "@/types/database";

/**
 * The daily form is the screen consultants use every day, so the behaviours
 * worth testing are the ones that would quietly cost someone their compliance:
 * a double-tap sending twice, the confirmation showing stale numbers, or a
 * read-only day still accepting input.
 *
 * The server actions are mocked - what they do is already covered by the
 * database suite. What is under test here is the component's behaviour.
 */

const saveDraft = vi.fn();
const submitDay = vi.fn();

vi.mock("@/app/(app)/today/actions", () => ({
  saveDraft: (fd: FormData) => saveDraft(fd),
  submitDay: (fd: FormData) => submitDay(fd),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const { DailyForm } = await import("@/components/daily/daily-form");

const submission: DailySubmission = {
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "22222222-2222-4222-8222-222222222222",
  business_date: "2026-03-10",
  dials: 12,
  talked_to: 5,
  campaign_status: "running",
  in_office: true,
  notes: "",
  status: "submitted",
  first_submitted_at: "2026-03-10T10:00:00Z",
  last_submitted_at: "2026-03-10T10:00:00Z",
  revision_count: 0,
  created_at: "2026-03-10T10:00:00Z",
  updated_at: "2026-03-10T10:00:00Z",
};

beforeEach(() => {
  saveDraft.mockReset().mockResolvedValue({ ok: true, message: "Draft saved." });
  submitDay.mockReset().mockResolvedValue({ ok: true, message: "Submitted." });
});

describe("daily form", () => {
  it("starts at zero for a day with nothing recorded", () => {
    render(
      <DailyForm businessDate="2026-03-10" submission={null} readOnly={false} />,
    );
    expect(screen.getByLabelText(/Dials/)).toHaveValue(0);
    expect(screen.getByLabelText(/Talked To/)).toHaveValue(0);
  });

  it("loads an existing submission's figures", () => {
    render(
      <DailyForm
        businessDate="2026-03-10"
        submission={submission}
        readOnly={false}
      />,
    );
    expect(screen.getByLabelText(/Dials/)).toHaveValue(12);
    expect(screen.getByLabelText(/Talked To/)).toHaveValue(5);
  });

  it("says Resubmit rather than Submit once a day is submitted", () => {
    render(
      <DailyForm
        businessDate="2026-03-10"
        submission={submission}
        readOnly={false}
      />,
    );
    expect(screen.getByTestId("open-submit")).toHaveTextContent("Resubmit");
  });

  it("sends what is currently on screen, not what was loaded", async () => {
    const user = userEvent.setup();
    render(
      <DailyForm
        businessDate="2026-03-10"
        submission={submission}
        readOnly={false}
      />,
    );

    const dials = screen.getByLabelText(/Dials/);
    await user.clear(dials);
    await user.type(dials, "40");

    await user.click(screen.getByTestId("save-draft"));

    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
    const sent = saveDraft.mock.calls[0]![0] as FormData;
    // The confirmation dialog renders in a portal outside the form, so reading
    // values from the DOM at submit time would send the stale 12.
    expect(sent.get("dials")).toBe("40");
    expect(sent.get("businessDate")).toBe("2026-03-10");
  });

  it("shows the figures again in the confirmation before submitting", async () => {
    const user = userEvent.setup();
    render(
      <DailyForm businessDate="2026-03-10" submission={null} readOnly={false} />,
    );

    const dials = screen.getByLabelText(/Dials/);
    await user.clear(dials);
    await user.type(dials, "33");

    await user.click(screen.getByTestId("open-submit"));

    expect(await screen.findByRole("dialog")).toHaveTextContent("D 33");
    expect(submitDay).not.toHaveBeenCalled();
  });

  it("does not submit until the confirmation is accepted", async () => {
    const user = userEvent.setup();
    render(
      <DailyForm businessDate="2026-03-10" submission={null} readOnly={false} />,
    );

    await user.click(screen.getByTestId("open-submit"));
    await user.click(screen.getByRole("button", { name: /Not yet/ }));

    expect(submitDay).not.toHaveBeenCalled();
  });

  it("sends exactly one request when the confirm button is double-tapped", async () => {
    const user = userEvent.setup();
    // A slow server is when a real person taps twice.
    submitDay.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ ok: true, message: "Submitted." }), 60),
        ),
    );

    render(
      <DailyForm businessDate="2026-03-10" submission={null} readOnly={false} />,
    );

    await user.click(screen.getByTestId("open-submit"));
    const confirm = await screen.findByTestId("confirm-submit");

    await user.click(confirm);
    await user.click(confirm).catch(() => {});
    await user.click(confirm).catch(() => {});

    await waitFor(() => expect(submitDay).toHaveBeenCalledTimes(1));
  });

  it("surfaces a field error from the server", async () => {
    const user = userEvent.setup();
    submitDay.mockResolvedValue({
      ok: false,
      fieldErrors: { dials: "Cannot be negative" },
    });

    render(
      <DailyForm businessDate="2026-03-10" submission={null} readOnly={false} />,
    );

    await user.click(screen.getByTestId("open-submit"));
    await user.click(await screen.findByTestId("confirm-submit"));

    expect(await screen.findByText("Cannot be negative")).toBeInTheDocument();
  });

  it("flips the office indicator between green and red", async () => {
    const user = userEvent.setup();
    render(
      <DailyForm businessDate="2026-03-10" submission={null} readOnly={false} />,
    );

    const dot = screen.getByTestId("office-indicator");
    expect(dot.className).toContain("bg-status-present");

    await user.click(screen.getByRole("switch", { name: /In the office/ }));
    expect(dot.className).toContain("bg-status-absent");
  });

  it("locks a day outside the edit window and says why", () => {
    render(
      <DailyForm
        businessDate="2026-02-01"
        submission={submission}
        readOnly
        readOnlyReason="This day is outside the 7-day window."
      />,
    );

    expect(screen.getByLabelText(/Dials/)).toBeDisabled();
    expect(screen.queryByTestId("save-draft")).not.toBeInTheDocument();
    expect(screen.queryByTestId("open-submit")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("7-day window");
  });

  it("shows the revision count once a day has been changed", () => {
    render(
      <DailyForm
        businessDate="2026-03-10"
        submission={{ ...submission, revision_count: 2 }}
        readOnly={false}
      />,
    );
    expect(screen.getByText(/2 revisions/)).toBeInTheDocument();
  });

  it("distinguishes a draft from a submitted day", () => {
    render(
      <DailyForm
        businessDate="2026-03-10"
        submission={{
          ...submission,
          status: "draft",
          first_submitted_at: null,
          last_submitted_at: null,
        }}
        readOnly={false}
      />,
    );
    expect(screen.getByText(/not submitted/i)).toBeInTheDocument();
  });
});
