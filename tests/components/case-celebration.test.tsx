/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Case, Insurer } from "@/types/database";

/**
 * Congratulations belongs to a NEW case and nothing else.
 *
 * Editing a case is bookkeeping. Celebrating it would mean the fifth
 * congratulations for correcting one typo, which is worse than none - so the
 * distinction is asserted rather than assumed.
 */

const createCase = vi.fn();
const updateCase = vi.fn();

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/cases",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/app/(app)/cases/actions", () => ({
  createCase: (fd: FormData) => createCase(fd),
  updateCase: (fd: FormData) => updateCase(fd),
  cancelCase: vi.fn(),
  restoreCase: vi.fn(),
  createInsurer: vi.fn(),
}));

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

const existingCase: Case = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  consultant_id: "22222222-2222-4222-8222-222222222222",
  date_submitted: "2026-08-03",
  date_incepted: null,
  client_name: "Ahmad",
  insurer_id: insurers[0]!.id,
  policy_name: "Secure Saver",
  policy_type: "Term",
  ape_amount: 1200,
  gr_amount: 800,
  status: "active",
  cancellation_reason: null,
  cancelled_at: null,
  created_at: "2026-08-03T00:00:00Z",
  updated_at: "2026-08-03T00:00:00Z",
};

const CELEBRATION = {
  clientName: "Ahmad",
  policyType: "Term",
  grAmount: 800,
  monthToDateGr: 7102,
  monthLabel: "August",
};

async function renderForm(existing?: Case) {
  const { CaseForm } = await import("@/components/cases/case-form");
  return render(
    <CaseForm
      open
      onOpenChange={() => {}}
      insurers={insurers}
      existing={existing}
    />,
  );
}

beforeEach(() => {
  createCase.mockReset();
  updateCase.mockReset();
});

describe("congratulations on a case submission", () => {
  it("appears when a new case is saved, naming the client and the GR", async () => {
    createCase.mockResolvedValue({
      ok: true,
      message: "Case added.",
      celebrate: CELEBRATION,
    });

    await renderForm();
    await userEvent.click(screen.getByTestId("save-case"));

    await waitFor(() =>
      expect(
        screen.getByText(/congratulations on your case submission/i),
      ).toBeTruthy(),
    );

    // The figures have to be the ones the server actually wrote. Matched
    // without the currency symbol on purpose: en-SG renders SGD as "S$" or
    // plain "$" depending on the ICU data in the runtime, and this test is
    // about the numbers being right, not about which symbol Node happens to
    // pick.
    expect(screen.getByText(/Ahmad/)).toBeTruthy();
    expect(screen.getByText(/800\.00/)).toBeTruthy();
    expect(screen.getByText(/7,102\.00/)).toBeTruthy();
    expect(screen.getByText(/August/)).toBeTruthy();
  });

  it("does NOT appear when an existing case is edited", async () => {
    updateCase.mockResolvedValue({ ok: true, message: "Case updated." });

    await renderForm(existingCase);
    await userEvent.click(screen.getByTestId("save-case"));

    await waitFor(() => expect(updateCase).toHaveBeenCalled());
    expect(
      screen.queryByText(/congratulations on your case submission/i),
    ).toBeNull();
  });

  it("does NOT appear when the save fails", async () => {
    createCase.mockResolvedValue({
      ok: false,
      message: "That case could not be saved.",
    });

    await renderForm();
    await userEvent.click(screen.getByTestId("save-case"));

    await waitFor(() => expect(createCase).toHaveBeenCalled());
    expect(
      screen.queryByText(/congratulations on your case submission/i),
    ).toBeNull();
  });
});
