/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * The first screen an invited consultant ever sees. If it is confusing or
 * accepts something the server will then reject, that is their first
 * impression of the whole system.
 */

const setPassword = vi.fn();

vi.mock("@/app/set-password/actions", () => ({
  setPassword: (fd: FormData) => setPassword(fd),
}));

const { SetPasswordForm } = await import(
  "@/app/set-password/set-password-form"
);

beforeEach(() => {
  setPassword.mockReset().mockResolvedValue({ ok: true });
});

describe("set password", () => {
  it("keeps the button disabled until both fields are valid", async () => {
    const user = userEvent.setup();
    render(<SetPasswordForm />);

    const save = screen.getByTestId("save-password");
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText("Choose a password"), "short");
    expect(save).toBeDisabled();

    await user.clear(screen.getByLabelText("Choose a password"));
    await user.type(
      screen.getByLabelText("Choose a password"),
      "a-long-enough-password",
    );
    // Long enough, but not confirmed yet.
    expect(save).toBeDisabled();

    await user.type(
      screen.getByLabelText("Type it again"),
      "a-long-enough-password",
    );
    expect(save).toBeEnabled();
  });

  it("stays disabled when the two do not match", async () => {
    const user = userEvent.setup();
    render(<SetPasswordForm />);

    await user.type(
      screen.getByLabelText("Choose a password"),
      "a-long-enough-password",
    );
    await user.type(screen.getByLabelText("Type it again"), "something-else");

    expect(screen.getByTestId("save-password")).toBeDisabled();
    expect(setPassword).not.toHaveBeenCalled();
  });

  it("confirms as you go rather than only on submit", async () => {
    const user = userEvent.setup();
    render(<SetPasswordForm />);

    await user.type(
      screen.getByLabelText("Choose a password"),
      "a-long-enough-password",
    );
    expect(screen.getByText(/At least 10 characters/)).toBeInTheDocument();

    await user.type(
      screen.getByLabelText("Type it again"),
      "a-long-enough-password",
    );
    expect(screen.getByText(/They match/)).toBeInTheDocument();
  });

  it("sends both values to the server", async () => {
    const user = userEvent.setup();
    render(<SetPasswordForm />);

    await user.type(
      screen.getByLabelText("Choose a password"),
      "correct-horse-battery",
    );
    await user.type(
      screen.getByLabelText("Type it again"),
      "correct-horse-battery",
    );
    await user.click(screen.getByTestId("save-password"));

    await waitFor(() => expect(setPassword).toHaveBeenCalledTimes(1));
    const sent = setPassword.mock.calls[0]![0] as FormData;
    expect(sent.get("password")).toBe("correct-horse-battery");
    expect(sent.get("confirm")).toBe("correct-horse-battery");
  });

  it("explains an expired link rather than failing silently", async () => {
    const user = userEvent.setup();
    setPassword.mockResolvedValue({
      ok: false,
      message:
        "Your sign-in link has expired. Ask your administrator for a new invitation.",
    });

    render(<SetPasswordForm />);
    await user.type(
      screen.getByLabelText("Choose a password"),
      "correct-horse-battery",
    );
    await user.type(
      screen.getByLabelText("Type it again"),
      "correct-horse-battery",
    );
    await user.click(screen.getByTestId("save-password"));

    expect(await screen.findByTestId("set-password-error")).toHaveTextContent(
      /expired/i,
    );
  });

  it("uses new-password autocomplete so a manager can save it", () => {
    render(<SetPasswordForm />);
    expect(screen.getByLabelText("Choose a password")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
  });
});
