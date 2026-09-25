import { test, expect } from "@playwright/test";

/**
 * Mobile layout checks at 375px width.
 * Fails on horizontal overflow (a common responsive bug).
 */
const PAGES = ["/", "/pricing", "/auth", "/features"];

for (const path of PAGES) {
  test(`no horizontal scroll on ${path} at 375px`, async ({ page }) => {
    await page.goto(path);
    // Wait for hydration
    await page.waitForLoadState("networkidle").catch(() => {});

    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return doc.scrollWidth - doc.clientWidth;
    });
    expect(
      overflow,
      `${path} has ${overflow}px horizontal overflow at 375px`
    ).toBeLessThanOrEqual(1);
  });
}

test("homepage hero is readable at 375px", async ({ page }) => {
  await page.goto("/");
  const hero = page.getByRole("heading", { name: /ai video studio/i });
  await expect(hero).toBeVisible();
  const box = await hero.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(375);
});
