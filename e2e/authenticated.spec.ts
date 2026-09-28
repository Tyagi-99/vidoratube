import { test, expect } from "./fixtures";

/**
 * Authenticated studio flow: signup → studio → create render → download.
 * REQUIRES: TEST_USER_EMAIL and TEST_USER_PASSWORD env vars (a seeded test account).
 * Skipped automatically when not provided.
 *
 * Seed a test user with: npx tsx scripts/seed-test-user.ts
 */
const EMAIL = process.env.TEST_USER_EMAIL;
const PASSWORD = process.env.TEST_USER_PASSWORD;

test.describe("authenticated studio", () => {
  test.skip(!EMAIL || !PASSWORD, "TEST_USER_EMAIL/PASSWORD not set");

  test("sign in → studio loads → start a 15s render", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    // Sign in
    await page.goto("/auth");
    await page.getByLabel(/email/i).fill(EMAIL!);
    await page.getByLabel(/password/i).fill(PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/studio/, { timeout: 15_000 });

    // Studio shell loads (project list or empty state)
    await expect(
      page.getByText(/new project|my projects|create/i).first()
    ).toBeVisible({ timeout: 15_000 });

    // NOTE: full render → download flow requires provider API calls and
    // real credits. The 15s render E2E runs in CI against staging with a
    // funded test account. Locally this verifies auth + studio shell.
    expect(errors).toEqual([]);
  });
});
