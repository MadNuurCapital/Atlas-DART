/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { AppointmentActivity, Insurer, TeamDailyRow } from "@/types/database";

/**
 * Does it render at all?
 *
 * The reminders card shipped with a hook misuse that threw during render and
 * took the whole page down with it. Nothing caught it because nothing ever
 * rendered that component - the suite tested behaviour in a handful of
 * components and left the rest entirely unexercised.
 *
 * These are not behaviour tests. Each one mounts a component with plausible
 * props and asserts only that it does not throw, which is the single cheapest
 * check that would have caught the bug that reached a real phone.
 */

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
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
    auth: {
      setSession: vi.fn().mockResolvedValue({ error: null }),
      exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
      verifyOtp: vi.fn().mockResolvedValue({ error: null }),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
  }),
}));

vi.mock("@/app/login/actions", () => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/app/(app)/cases/actions", () => ({
  createCase: vi.fn(),
  updateCase: vi.fn(),
  cancelCase: vi.fn(),
  restoreCase: vi.fn(),
  createInsurer: vi.fn(),
}));

vi.mock("@/app/(app)/today/actions", () => ({
  saveDraft: vi.fn(),
  submitDay: vi.fn(),
  addAppointment: vi.fn(),
  updateAppointment: vi.fn(),
  removeAppointment: vi.fn(),
}));

vi.mock("@/app/(app)/admin/targets/actions", () => ({
  setTarget: vi.fn(),
  clearMonthlyOverride: vi.fn(),
  renameInsurer: vi.fn(),
  setInsurerActive: vi.fn(),
  mergeInsurers: vi.fn(),
}));

vi.mock("@/app/(app)/admin/users/actions", () => ({
  inviteUser: vi.fn(),
  setUserRole: vi.fn(),
  setUserActive: vi.fn(),
  resendInvite: vi.fn(),
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

const teamRow: TeamDailyRow = {
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

const appointment: AppointmentActivity = {
  id: "44444444-4444-4444-8444-444444444444",
  daily_submission_id: "33333333-3333-4333-8333-333333333333",
  user_id: "22222222-2222-4222-8222-222222222222",
  business_date: "2026-03-10",
  prospect_name: "Ahmad",
  appointment_type: "opening",
  note: null,
  created_at: "2026-03-10T12:00:00Z",
  updated_at: "2026-03-10T12:00:00Z",
};

describe("every client component mounts without throwing", () => {
  it("the team board", async () => {
    const { TeamBoard } = await import("@/components/admin/team-board");
    expect(() =>
      render(<TeamBoard initialRows={[teamRow]} businessDate="2026-03-10" />),
    ).not.toThrow();
  });

  it("the team board with nobody on it", async () => {
    const { TeamBoard } = await import("@/components/admin/team-board");
    expect(() =>
      render(<TeamBoard initialRows={[]} businessDate="2026-03-10" />),
    ).not.toThrow();
  });

  it("the insurer manager", async () => {
    const { InsurerManager } = await import(
      "@/components/admin/insurer-manager"
    );
    expect(() =>
      render(
        <InsurerManager
          insurers={insurers}
          caseCounts={{ [insurers[0]!.id]: 3 }}
        />,
      ),
    ).not.toThrow();
  });

  it("the target editor, including someone with no target set", async () => {
    const { TargetEditor } = await import("@/components/admin/target-editor");
    expect(() =>
      render(
        <TargetEditor
          year={2026}
          consultants={[
            {
              consultantId: "22222222-2222-4222-8222-222222222222",
              fullName: "Nur Aisyah",
              role: "consultant",
              yearlyTarget: 120000,
              monthlyOverrides: [
                {
                  id: "55555555-5555-4555-8555-555555555555",
                  month: 12,
                  grTarget: 5000,
                },
              ],
            },
            {
              consultantId: "66666666-6666-4666-8666-666666666666",
              fullName: "Faizal",
              role: "admin",
              yearlyTarget: null,
              monthlyOverrides: [],
            },
          ]}
        />,
      ),
    ).not.toThrow();
  });

  it("the user manager", async () => {
    const { UserManager } = await import("@/components/admin/user-manager");
    expect(() =>
      render(
        <UserManager
          users={[
            {
              id: "22222222-2222-4222-8222-222222222222",
              fullName: "Nur Aisyah",
              email: "aisyah@example.test",
              role: "consultant",
              active: true,
              lastSubmission: "2026-03-10",
            },
            {
              id: "66666666-6666-4666-8666-666666666666",
              fullName: "Departed Colleague",
              email: "gone@example.test",
              role: "consultant",
              active: false,
              lastSubmission: null,
            },
          ]}
        />,
      ),
    ).not.toThrow();
  });

  it("the export form", async () => {
    const { ExportForm } = await import("@/components/admin/export-form");
    expect(() =>
      render(
        <ExportForm
          consultants={[
            {
              id: "22222222-2222-4222-8222-222222222222",
              full_name: "Nur Aisyah",
            },
          ]}
          currentYear={2026}
          currentMonth={3}
        />,
      ),
    ).not.toThrow();
  });

  it("the appointment manager", async () => {
    const { AppointmentManager } = await import(
      "@/components/daily/appointment-manager"
    );
    expect(() =>
      render(
        <AppointmentManager
          businessDate="2026-03-10"
          appointments={[appointment]}
          readOnly={false}
        />,
      ),
    ).not.toThrow();
  });

  it("the appointment manager on a day that can no longer be edited", async () => {
    const { AppointmentManager } = await import(
      "@/components/daily/appointment-manager"
    );
    expect(() =>
      render(
        <AppointmentManager
          businessDate="2026-01-01"
          appointments={[]}
          readOnly
        />,
      ),
    ).not.toThrow();
  });

  it("the case form", async () => {
    const { CaseForm } = await import("@/components/cases/case-form");
    expect(() =>
      render(
        <CaseForm insurers={insurers} open onOpenChange={() => {}} />,
      ),
    ).not.toThrow();
  });

  it("the bottom navigation", async () => {
    const { BottomNav } = await import("@/components/app-shell/bottom-nav");
    expect(() => render(<BottomNav />)).not.toThrow();
    expect(() => render(<BottomNav needsSubmission />)).not.toThrow();
  });

  it("the login form", async () => {
    const { LoginForm } = await import("@/app/login/login-form");
    expect(() => render(<LoginForm />)).not.toThrow();
    expect(() => render(<LoginForm redirectTo="/cases" />)).not.toThrow();
  });

  it("the side navigation", async () => {
    const { SideNav } = await import("@/components/app-shell/side-nav");
    expect(() => render(<SideNav isAdmin={false} />)).not.toThrow();
    expect(() => render(<SideNav isAdmin />)).not.toThrow();
  });

  it("the invitation callback handler", async () => {
    const { CallbackHandler } = await import(
      "@/app/auth/callback/callback-handler"
    );
    expect(() => render(<CallbackHandler />)).not.toThrow();
  });

  it("the error screen", async () => {
    const { default: ErrorScreen } = await import("@/app/error");
    expect(() =>
      render(
        <ErrorScreen
          error={Object.assign(new Error("boom"), { digest: "abc123" })}
          reset={() => {}}
        />,
      ),
    ).not.toThrow();
  });
});
