import { test, expect } from "@playwright/test";

/**
 * Phase 6 Stream E — Watchtower alerts + packaging checklist smoke test.
 * REQUIRES: TEST_USER_EMAIL and TEST_USER_PASSWORD env vars (a seeded test account).
 * Skipped automatically when not provided (same convention as authenticated.spec.ts).
 */
const EMAIL = process.env.TEST_USER_EMAIL;
const PASSWORD = process.env.TEST_USER_PASSWORD;

test.describe("stream E — watchtower & packaging checklist", () => {
  test.skip(!EMAIL || !PASSWORD, "TEST_USER_EMAIL/PASSWORD not set");

  test.beforeEach(async ({ page }) => {
    await page.goto("/auth");
    await page.getByLabel(/email/i).fill(EMAIL!);
    await page.getByLabel(/password/i).fill(PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/studio/, { timeout: 15_000 });
  });

  test("watchtower page loads with honest empty state", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/intelligence/alerts");
    await expect(page.getByRole("heading", { name: /watchtower/i })).toBeVisible({
      timeout: 15_000,
    });
    // Either the empty-state CTA or existing rules must render — never a spinner forever.
    await expect(
      page.getByText(/no alert rules yet|new rule|check now/i).first()
    ).toBeVisible({ timeout: 15_000 });
    expect(errors).toEqual([]);
  });

  test("publish review renders the advisory packaging checklist", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/publish/review");
    await expect(page.getByText(/review queue/i)).toBeVisible({ timeout: 15_000 });
    // Click the first queued job if any, then the checklist section must appear.
    const firstJob = page.locator("li button").first();
    if (await firstJob.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await firstJob.click();
      await expect(page.getByText(/packaging checklist/i)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/advisory only/i)).toBeVisible({ timeout: 5_000 });
    }
    expect(errors).toEqual([]);
  });
});
