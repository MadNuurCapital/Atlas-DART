/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CaseWithInsurer } from "@/components/cases/case-list";
import type { Insurer } from "@/types/database";

const cancelCase = vi.fn();
const restoreCase = vi.fn();

vi.mock("@/app/(app)/cases/actions", () => ({
  cancelCase: (fd: FormData) => cancelCase(fd),
  restoreCase: (fd: FormData) => restoreCase(fd),
  createCase: vi.fn(),
  updateCase: vi.fn(),
  createInsurer: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const { CaseList } = await import("@/components/cases/case-list");

const insurers: Insurer[] = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "AIA Singapore",
    active: true,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
];

function makeCase(overrides: Partial<CaseWithInsurer> = {}): CaseWithInsurer {
  return {
    id: crypto.randomUUID(),
    consultant_id: "22222222-2222-4222-8222-222222222222",
    date_submitted: "2026-03-10",
    date_incepted: "2026-03-20",
    client_name: "Mr Tan",
    insurer_id: insurers[0]!.id,
    policy_name: "Protect Plus",
    policy_type: "Term",
    ape_amount: 1200,
    gr_amount: 600,
    status: "active",
    cancellation_reason: null,
    cancelled_at: null,
    created_at: "2026-03-10T00:00:00Z",
    updated_at: "2026-03-10T00:00:00Z",
    insurer_name: "AIA Singapore",
    ...overrides,
  };
}

beforeEach(() => {
  cancelCase.mockReset().mockResolvedValue({ ok: true, message: "Cancelled." });
  restoreCase.mockReset().mockResolvedValue({ ok: true, message: "Restored." });
});

describe("case list", () => {
  it("totals only the active GR on screen", () => {
    render(
      <CaseList
        cases={[
          makeCase({ gr_amount: 600 }),
          makeCase({ gr_amount: 400 }),
          makeCase({
            gr_amount: 9999,
            status: "cancelled",
            cancellation_reason: "Free-look",
            cancelled_at: "2026-03-15T00:00:00Z",
          }),
        ]}
        insurers={insurers}
        isAdmin={false}
      />,
    );

    // The cancelled 9,999 must not be in the total.
    expect(screen.getByText(/1,000\.00/)).toBeInTheDocument();
    expect(screen.queryByText(/9,999/)).not.toBeInTheDocument();
  });

  it("separates active from cancelled with counts", () => {
    render(
      <CaseList
        cases={[
          makeCase(),
          makeCase({
            status: "cancelled",
            cancellation_reason: "Free-look",
            cancelled_at: "2026-03-15T00:00:00Z",
          }),
        ]}
        insurers={insurers}
        isAdmin={false}
      />,
    );

    expect(screen.getByRole("button", { name: /Active \(1\)/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Cancelled \(1\)/ }),
    ).toBeInTheDocument();
  });

  it("flags a case that has not incepted yet", () => {
    render(
      <CaseList
        cases={[makeCase({ date_incepted: null })]}
        insurers={insurers}
        isAdmin={false}
      />,
    );
    expect(screen.getByText(/Pending inception/)).toBeInTheDocument();
  });

  it("filters by client name", async () => {
    const user = userEvent.setup();
    render(
      <CaseList
        cases={[
          makeCase({ client_name: "Mr Tan" }),
          makeCase({ client_name: "Mrs Lim" }),
        ]}
        insurers={insurers}
        isAdmin={false}
      />,
    );

    await user.type(screen.getByLabelText("Search cases"), "Lim");

    expect(screen.getByText("Mrs Lim")).toBeInTheDocument();
    expect(screen.queryByText("Mr Tan")).not.toBeInTheDocument();
  });

  it("refuses to cancel without a reason", async () => {
    const user = userEvent.setup();
    cancelCase.mockResolvedValue({
      ok: false,
      fieldErrors: { reason: "Give a reason so this can be understood later" },
    });

    render(
      <CaseList cases={[makeCase()]} insurers={insurers} isAdmin={false} />,
    );

    await user.click(screen.getByRole("button", { name: /Cancel and remove/ }));
    await user.click(await screen.findByTestId("confirm-cancel-case"));

    expect(await screen.findByText(/Give a reason/)).toBeInTheDocument();
  });

  it("passes the typed reason to the server", async () => {
    const user = userEvent.setup();
    render(
      <CaseList cases={[makeCase()]} insurers={insurers} isAdmin={false} />,
    );

    await user.click(screen.getByRole("button", { name: /Cancel and remove/ }));
    await user.type(
      await screen.findByLabelText(/Reason/),
      "Client cancelled during free-look",
    );
    await user.click(screen.getByTestId("confirm-cancel-case"));

    await waitFor(() => expect(cancelCase).toHaveBeenCalledTimes(1));
    const sent = cancelCase.mock.calls[0]![0] as FormData;
    expect(sent.get("reason")).toBe("Client cancelled during free-look");
  });

  it("warns that cancelling stops it counting, before it happens", async () => {
    const user = userEvent.setup();
    render(
      <CaseList cases={[makeCase()]} insurers={insurers} isAdmin={false} />,
    );

    await user.click(screen.getByRole("button", { name: /Cancel and remove/ }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/stops counting immediately/i);
    expect(dialog).toHaveTextContent(/record is kept/i);
  });

  it("offers Restore to an admin only", async () => {
    const user = userEvent.setup();
    const cancelled = makeCase({
      status: "cancelled",
      cancellation_reason: "Free-look",
      cancelled_at: "2026-03-15T00:00:00Z",
    });

    const { unmount } = render(
      <CaseList cases={[cancelled]} insurers={insurers} isAdmin={false} />,
    );
    await user.click(screen.getByRole("button", { name: /Cancelled \(1\)/ }));
    expect(
      screen.queryByRole("button", { name: /Restore/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Only an admin can restore/)).toBeInTheDocument();
    unmount();

    render(<CaseList cases={[cancelled]} insurers={insurers} isAdmin />);
    await user.click(screen.getByRole("button", { name: /Cancelled \(1\)/ }));
    expect(screen.getByRole("button", { name: /Restore/ })).toBeInTheDocument();
  });

  it("shows the cancellation reason on a cancelled case", async () => {
    const user = userEvent.setup();
    render(
      <CaseList
        cases={[
          makeCase({
            status: "cancelled",
            cancellation_reason: "Client changed their mind",
            cancelled_at: "2026-03-15T00:00:00Z",
          }),
        ]}
        insurers={insurers}
        isAdmin
      />,
    );

    await user.click(screen.getByRole("button", { name: /Cancelled \(1\)/ }));
    expect(screen.getByText(/Client changed their mind/)).toBeInTheDocument();
  });

  it("hides Add case where it is not allowed", () => {
    render(
      <CaseList
        cases={[makeCase()]}
        insurers={insurers}
        isAdmin
        canAdd={false}
      />,
    );
    expect(screen.queryByTestId("add-case")).not.toBeInTheDocument();
  });
});
