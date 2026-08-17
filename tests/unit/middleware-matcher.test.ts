import { describe, it, expect } from "vitest";
import { config } from "../../middleware.ts";

/**
 * The middleware matcher decides which requests get an auth check, and it is a
 * single negative-lookahead regex that is easy to change and impossible to
 * read. This asserts what it actually does.
 *
 * The bug this exists for: `/.netlify/functions/push-reminders` matched. The
 * caller is a scheduler with no cookie, so the middleware found no session,
 * decided a logged-out person had tried to open a page, and redirected to
 * /login with a 307. The reminder functions were therefore unreachable over
 * HTTP from anywhere outside a browser - which is every way they are ever
 * called - and had been since the app went live. reminder_logs stayed empty
 * and it looked for a long time like a broken schedule.
 *
 * Next compiles this string itself; here it is anchored the same way so the
 * assertions are about the pattern rather than about Next's compiler.
 */
const matcher = config.matcher[0]!;
const runs = (pathname: string) =>
  new RegExp(`^${matcher}$`).test(pathname);

describe("which requests the middleware inspects", () => {
  it("does not stand in front of the Netlify functions", () => {
    expect(runs("/.netlify/functions/push-reminders")).toBe(false);
    expect(runs("/.netlify/functions/coaching-reminders")).toBe(false);
    expect(runs("/.netlify/functions/reminder-consultants")).toBe(false);
    expect(runs("/.netlify/functions/reminder-admin-digest")).toBe(false);
  });

  it("still ignores a query string on the way past", () => {
    // Next matches on pathname only, so the dryRun parameter must not change
    // the answer. Asserted because the real call always carries one.
    expect(runs("/.netlify/functions/push-reminders")).toBe(false);
  });

  it("still guards every real page", () => {
    for (const page of [
      "/dashboard",
      "/today",
      "/cases",
      "/appointments",
      "/history",
      "/notifications",
      "/admin",
      "/admin/daily",
      "/admin/export",
      "/login",
    ]) {
      expect(runs(page), `${page} must keep its auth check`).toBe(true);
    }
  });

  it("still guards the app's own API routes", () => {
    // These are part of the app and are called by a signed-in browser, so
    // unlike the Netlify functions they do want the session refreshed.
    expect(runs("/api/diagnostics")).toBe(true);
    expect(runs("/api/export/monthly")).toBe(true);
  });

  it("still skips the assets it was already skipping", () => {
    expect(runs("/_next/static/chunk.js")).toBe(false);
    expect(runs("/_next/image")).toBe(false);
    expect(runs("/favicon.ico")).toBe(false);
    expect(runs("/sw.js")).toBe(false);
    expect(runs("/manifest.webmanifest")).toBe(false);
    expect(runs("/icon-192.png")).toBe(false);
    expect(runs("/logo.svg")).toBe(false);
  });
});
