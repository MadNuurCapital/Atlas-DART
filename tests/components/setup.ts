import { afterEach } from "vitest";

/**
 * Shared setup. Runs for every suite, but the DOM matchers and cleanup only
 * make sense where a DOM exists - the date and SQL suites deliberately run in
 * a plain Node environment.
 */
if (typeof document !== "undefined") {
  await import("@testing-library/jest-dom/vitest");
  const { cleanup } = await import("@testing-library/react");

  afterEach(() => {
    cleanup();
  });
}
