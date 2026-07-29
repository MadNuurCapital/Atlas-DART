/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { default: ErrorScreen } = await import("@/app/error");

function fail(name: string, message: string, digest?: string) {
  const error = new globalThis.Error(message) as Error & { digest?: string };
  error.name = name;
  if (digest) error.digest = digest;
  return error;
}

let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  sessionStorage.clear();

  reload = vi.fn();
  Object.defineProperty(window, "location", {
    value: { ...window.location, reload },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the error screen", () => {
  it("shows what actually went wrong", () => {
    // "Something went wrong" with no detail is unreportable: nobody here has a
    // browser console open, so the only evidence is what is on the screen.
    render(
      <ErrorScreen
        error={fail("TypeError", "x.matchMedia is not a function")}
        reset={() => {}}
      />,
    );

    expect(
      screen.getByText(/TypeError: x.matchMedia is not a function/),
    ).toBeInTheDocument();
  });

  it("includes the digest when the failure came from the server", () => {
    render(
      <ErrorScreen
        error={fail("Error", "Could not read your cases", "9fa1c2")}
        reset={() => {}}
      />,
    );

    expect(screen.getByText(/9fa1c2/)).toBeInTheDocument();
  });

  it("copes with an error carrying no message at all", () => {
    render(<ErrorScreen error={fail("Error", "")} reset={() => {}} />);
    expect(screen.getByText(/no message/)).toBeInTheDocument();
  });

  it("reloads once when the browser is running a stale build", () => {
    // After a deploy the old code asks for a chunk that no longer exists. That
    // is not a bug, and reloading fixes it completely.
    render(
      <ErrorScreen
        error={fail("ChunkLoadError", "Loading chunk 42 failed")}
        reset={() => {}}
      />,
    );

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload a second time, so it cannot loop", () => {
    const error = fail("ChunkLoadError", "Loading chunk 42 failed");

    render(<ErrorScreen error={error} reset={() => {}} />);
    expect(reload).toHaveBeenCalledTimes(1);

    render(<ErrorScreen error={error} reset={() => {}} />);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Please reload the app")).toBeInTheDocument();
  });

  it("never reloads for an ordinary failure", () => {
    render(
      <ErrorScreen
        error={fail("Error", "Could not read your cases")}
        reset={() => {}}
      />,
    );

    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("re-arms the reload once the app is running current code again", () => {
    render(
      <ErrorScreen
        error={fail("ChunkLoadError", "Loading chunk 42 failed")}
        reset={() => {}}
      />,
    );
    expect(reload).toHaveBeenCalledTimes(1);

    // An unrelated error means the app loaded fine, so a future stale build
    // should be allowed to reload again rather than being stuck.
    render(
      <ErrorScreen error={fail("Error", "unrelated")} reset={() => {}} />,
    );
    render(
      <ErrorScreen
        error={fail("ChunkLoadError", "Loading chunk 43 failed")}
        reset={() => {}}
      />,
    );

    expect(reload).toHaveBeenCalledTimes(2);
  });
});
