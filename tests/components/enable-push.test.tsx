/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/app/(app)/notifications/actions", () => ({
  savePushSubscription: vi.fn(),
  removePushSubscription: vi.fn(),
  sendTestPush: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const { EnablePush } = await import("@/components/notifications/enable-push");

const VAPID = "BJ1p_TESTKEYTESTKEYTESTKEYTESTKEYTESTKEY";

/** Pretend to be a particular browser for the length of one test. */
function asBrowser(opts: {
  userAgent?: string;
  standalone?: boolean;
  permission?: NotificationPermission;
  push?: boolean;
}) {
  const {
    userAgent = "Mozilla/5.0 (Macintosh) Chrome/140",
    standalone = false,
    permission = "default",
    push = true,
  } = opts;

  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);

  window.matchMedia = ((query: string) => ({
    matches: standalone && query.includes("standalone"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  if (push) {
    Object.defineProperty(navigator, "serviceWorker", {
      value: { register: vi.fn(), ready: Promise.resolve(), getRegistration: vi.fn() },
      configurable: true,
    });
    (window as unknown as { PushManager: unknown }).PushManager = class {};
    (window as unknown as { Notification: unknown }).Notification = { permission };
    (globalThis as unknown as { Notification: unknown }).Notification = { permission };
  }
}

beforeEach(() => {
  delete (window as unknown as { PushManager?: unknown }).PushManager;
  delete (window as unknown as { Notification?: unknown }).Notification;
  delete (globalThis as unknown as { Notification?: unknown }).Notification;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the reminders card", () => {
  // This component crashed the whole page on a real phone. Its getSnapshot
  // built a fresh object on every call, and React refuses a snapshot that is
  // never referentially equal - it treats it as a store that will not settle
  // and throws rather than looping forever. Nothing rendered this component in
  // a test, so nothing caught it.

  it("renders without throwing on a browser that supports push", () => {
    asBrowser({});
    expect(() =>
      render(<EnablePush vapidPublicKey={VAPID} initiallyEnabled={false} />),
    ).not.toThrow();

    expect(screen.getByText("Daily reminders")).toBeInTheDocument();
    expect(screen.getByTestId("enable-push")).toBeInTheDocument();
  });

  it("renders without throwing when the server has no VAPID key", () => {
    asBrowser({});
    expect(() =>
      render(<EnablePush vapidPublicKey={null} initiallyEnabled={false} />),
    ).not.toThrow();

    expect(screen.getByText(/not configured on the server/i)).toBeInTheDocument();
  });

  it("tells an iPhone user in Safari to install to the Home Screen first", () => {
    asBrowser({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari" });
    render(<EnablePush vapidPublicKey={VAPID} initiallyEnabled={false} />);

    expect(screen.getByText(/add this to your Home Screen/i)).toBeInTheDocument();
    // No point offering a button Apple will not honour.
    expect(screen.queryByTestId("enable-push")).not.toBeInTheDocument();
  });

  it("offers the button once the iPhone app is installed", () => {
    asBrowser({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari",
      standalone: true,
    });
    render(<EnablePush vapidPublicKey={VAPID} initiallyEnabled={false} />);

    expect(screen.getByTestId("enable-push")).toBeInTheDocument();
  });

  it("explains itself when the browser has no push support at all", () => {
    asBrowser({ push: false });
    render(<EnablePush vapidPublicKey={VAPID} initiallyEnabled={false} />);

    expect(
      screen.getByText(/does not support notifications/i),
    ).toBeInTheDocument();
  });

  it("says so when notifications have been blocked", () => {
    asBrowser({ permission: "denied" });
    render(<EnablePush vapidPublicKey={VAPID} initiallyEnabled={false} />);

    expect(screen.getByText(/blocked for this site/i)).toBeInTheDocument();
  });

  it("shows the on state and a test button when already subscribed", () => {
    asBrowser({ permission: "granted" });
    render(<EnablePush vapidPublicKey={VAPID} initiallyEnabled />);

    expect(screen.getByText("On")).toBeInTheDocument();
    expect(screen.getByTestId("test-push")).toBeInTheDocument();
  });
});
