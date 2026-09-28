import { test, expect } from "./fixtures";

/**
 * Public pages: no auth required.
 * Verifies the marketing site renders and the auth gate works.
 */
test.describe("public pages", () => {
  test("homepage renders with hero and no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    await page.goto("/");
    await expect(page).toHaveTitle(/Vidora/i);
    // Hero heading (cinema redesign: "Script in. Film out.")
    await expect(
      page.getByRole("heading", { name: /script in/i })
    ).toBeVisible();
    // Pricing tiers visible on homepage
    await expect(page.getByText(/\$19/)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("pricing page shows plan cards and honest checkout note", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page).toHaveTitle(/Pricing/i);
    await expect(page.getByText(/\$19/)).toBeVisible();
    await expect(page.getByText(/\$49/)).toBeVisible();
    await expect(page.getByText(/\$149/)).toBeVisible();
    // Honesty: checkout not live is disclosed ("Checkout is being set up")
    await expect(page.getByText(/checkout is being set up/i).first()).toBeVisible();
  });

  test("studio is auth-gated", async ({ page }) => {
    await page.goto("/studio");
    await expect(page).toHaveURL(/\/auth/);
  });

  test("auth page renders sign-in form", async ({ page }) => {
    await page.goto("/auth");
    await expect(page.getByLabel(/email/i)).toBeVisible();
  });
});
