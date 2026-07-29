/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act } from "react";

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

/**
 * The browser does not call render() - it hydrates.
 *
 * A component can pass a client-only render and still blow up on hydration,
 * because that is where useSyncExternalStore switches from the server snapshot
 * to the client one. Since the page crashed on a real phone and not in the
 * suite, the difference between the two paths is worth testing directly.
 */
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

/** jsdom has no matchMedia; a real browser does. */
function stubMatchMedia(impl?: () => never) {
  window.matchMedia = (impl ??
    ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }))) as unknown as typeof window.matchMedia;
}

function hydrateWith(ui: React.ReactElement) {
  const html = renderToString(ui);

  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);

  const errors: unknown[] = [];
  act(() => {
    hydrateRoot(container, ui, {
      onRecoverableError: (error) => errors.push(error),
    });
  });

  return { container, errors };
}

describe("the reminders card survives hydration", () => {
  it("hydrates on a browser that supports push", () => {
    Object.defineProperty(navigator, "serviceWorker", {
      value: { register: vi.fn(), ready: Promise.resolve() },
      configurable: true,
    });
    (window as unknown as { PushManager: unknown }).PushManager = class {};
    (globalThis as unknown as { Notification: unknown }).Notification = {
      permission: "default",
    };
    stubMatchMedia();

    const { container } = hydrateWith(
      <EnablePush vapidPublicKey={VAPID} initiallyEnabled={false} />,
    );

    // Reaching here at all is the assertion: a throw during hydration is what
    // replaced the whole page with the error screen.
    expect(container.textContent).toContain("Daily reminders");
  });

  it("hydrates when the server has no VAPID key", () => {
    stubMatchMedia();
    const { container } = hydrateWith(
      <EnablePush vapidPublicKey={null} initiallyEnabled={false} />,
    );
    expect(container.textContent).toContain("Daily reminders");
  });

  it("survives a browser that refuses to answer the capability question", () => {
    // Reading these APIs can throw in a private window, an embedded webview or
    // on a locked-down device. It happens inside getSnapshot, so an unguarded
    // throw takes down the entire page rather than just this card - which is
    // exactly what a consultant reported.
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubMatchMedia(() => {
      throw new Error("SecurityError: the operation is insecure");
    });

    const { container } = hydrateWith(
      <EnablePush vapidPublicKey={VAPID} initiallyEnabled={false} />,
    );

    expect(container.textContent).toContain("Daily reminders");
    expect(container.textContent).toMatch(/would not say whether/i);
  });
});
