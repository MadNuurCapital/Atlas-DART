/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { AuditTrail, type AuditEntry } from "@/components/admin/audit-trail";

/**
 * The audit trail is what makes "an admin may edit their own target"
 * acceptable rather than a hole. It is only useful if the change it shows is
 * the change that happened - a diff that quietly drops a field, or renders a
 * numeric target as a raw string, undermines the whole control.
 */

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: crypto.randomUUID(),
    actorName: "Muhammad",
    action: "target_changed",
    entityType: "consultant_targets",
    entityId: crypto.randomUUID(),
    oldValues: { gr_target: 120000 },
    newValues: { gr_target: 150000 },
    createdAt: "2026-03-10T02:00:00Z",
    ...overrides,
  };
}

describe("audit trail", () => {
  /**
   * The action label appears twice on screen - once as a filter button and
   * once as the entry's own badge - so assertions about an entry are scoped to
   * the list rather than to the whole document.
   */
  function inList() {
    return within(screen.getByTestId("audit-entries"));
  }

  it("names who did it and what they did in plain English", () => {
    render(<AuditTrail entries={[entry()]} />);
    expect(screen.getByText("Muhammad")).toBeInTheDocument();
    // Not "target_changed".
    expect(inList().getByText("Changed a target")).toBeInTheDocument();
  });

  it("shows the movement, not just the destination", () => {
    render(<AuditTrail entries={[entry()]} />);
    expect(screen.getByText(/120,000\.00/)).toBeInTheDocument();
    expect(screen.getByText(/150,000\.00/)).toBeInTheDocument();
  });

  it("formats money as money rather than as a bare number", () => {
    render(<AuditTrail entries={[entry()]} />);
    expect(screen.getByText(/\$150,000\.00/)).toBeInTheDocument();
  });

  it("lists only the fields that actually moved", () => {
    render(
      <AuditTrail
        entries={[
          entry({
            action: "case_updated",
            oldValues: {
              client_name: "Mr Tan",
              gr_amount: 600,
              policy_name: "Protect Plus",
            },
            newValues: {
              client_name: "Mr Tan",
              gr_amount: 900,
              policy_name: "Protect Plus",
            },
          }),
        ]}
      />,
    );

    // An entry that lists every column is complete and unreadable. The
    // question is always "what did they change".
    expect(screen.getByText("GR")).toBeInTheDocument();
    expect(screen.queryByText("Client")).not.toBeInTheDocument();
    expect(screen.queryByText("Policy")).not.toBeInTheDocument();
  });

  it("shows a creation as values, not as a change from nothing", () => {
    render(
      <AuditTrail
        entries={[
          entry({
            action: "case_created",
            oldValues: null,
            newValues: { client_name: "Mrs Lim", gr_amount: 2500 },
          }),
        ]}
      />,
    );

    expect(inList().getByText("Added a case")).toBeInTheDocument();
    expect(screen.getByText("Mrs Lim")).toBeInTheDocument();
    // No struck-through "from" value on a creation.
    expect(document.querySelector(".line-through")).toBeNull();
  });

  it("renders booleans readably", () => {
    render(
      <AuditTrail
        entries={[
          entry({
            action: "user_deactivated",
            oldValues: { active: true },
            newValues: { active: false },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Yes")).toBeInTheDocument();
    expect(screen.getByText("No")).toBeInTheDocument();
  });

  it("renders a null as a dash rather than the word null", () => {
    render(
      <AuditTrail
        entries={[
          entry({
            action: "case_restored",
            oldValues: { cancellation_reason: "Free-look" },
            newValues: { cancellation_reason: null },
          }),
        ]}
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("null")).not.toBeInTheDocument();
  });

  it("filters by action", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();

    render(
      <AuditTrail
        entries={[
          entry({ actorName: "Muhammad", action: "target_changed" }),
          entry({
            actorName: "Ahmad",
            action: "case_cancelled",
            oldValues: { status: "active" },
            newValues: { status: "cancelled" },
          }),
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Cancelled a case" }));

    expect(screen.getByText("Ahmad")).toBeInTheDocument();
    expect(screen.queryByText("Muhammad")).not.toBeInTheDocument();
  });

  it("says so plainly when there is nothing recorded", () => {
    render(<AuditTrail entries={[]} />);
    expect(screen.getByText(/Nothing recorded yet/)).toBeInTheDocument();
  });

  it("survives an actor whose account no longer exists", () => {
    render(<AuditTrail entries={[entry({ actorName: "Deleted account" })]} />);
    expect(screen.getByText("Deleted account")).toBeInTheDocument();
  });
});
