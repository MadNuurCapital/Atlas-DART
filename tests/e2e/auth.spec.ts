import { test, expect } from "@playwright/test";

/**
 * Access-control end-to-end checks.
 *
 * These run without a Supabase project: they exercise the unauthenticated
 * paths, which is exactly where a middleware mistake would be most costly.
 * The signed-in journeys arrive with Phase 2, once there are seeded accounts
 * to sign in as.
 */

test("sends an unauthenticated visitor to the login page", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await expect(
    page.getByRole("heading", { name: "Sign in" }),
  ).toBeVisible();
});

test("remembers where the visitor was heading", async ({ page }) => {
  await page.goto("/cases");
  await expect(page).toHaveURL(/redirectTo=%2Fcases/);
});

test("keeps an unauthenticated visitor out of the admin area", async ({
  page,
}) => {
  await page.goto("/admin/export");
  await expect(page).toHaveURL(/\/login/);
});

test("redirects the site root to the dashboard, and therefore to login", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("shows validation rather than submitting an empty form", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in" }).click();

  // The form is noValidate, so these come back from the server action.
  await expect(page.getByText("Enter your email")).toBeVisible();
  await expect(page.getByText("Enter your password")).toBeVisible();
});

test("does not reveal whether an email address exists", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("nobody@example.test");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  // Scoped by test id rather than role: Next.js renders its own route
  // announcer with role="alert", so a role query matches two elements.
  const alert = page.getByTestId("login-error");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("did not match");
  // Must not distinguish "no such user" from "wrong password".
  await expect(alert).not.toContainText(/not found|no account|unknown user/i);
});

test("the login page is usable on a phone without horizontal scrolling", async ({
  page,
}) => {
  await page.goto("/login");
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflows).toBe(false);
});
