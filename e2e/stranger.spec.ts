import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { test, expect, type Page } from "./fixtures";

/**
 * Stranger test: what a logged-out stranger can do on the live site.
 *
 * Target: E2E_BASE_URL (default http://127.0.0.1:3100).
 * Run against prod:  E2E_BASE_URL=https://vidoratube.lovable.app/ npx playwright test stranger
 * Or:                E2E_BASE_URL=https://vidoratube.lovable.app/ npm run test:e2e -- stranger
 *
 * CI-runnable: every step that needs secrets, paid credits, or a live render
 * worker skips gracefully with an explicit reason instead of failing.
 *
 * Gating:
 *  - Homepage checks: always run.
 *  - Signup: runs when TEST_USER_PASSWORD is set (explicit opt-in; creating a
 *    real account) OR when the target is localhost. Otherwise skipped.
 *  - Render cost preview: runs after a successful signup in the same worker;
 *    otherwise skipped.
 *  - Full render + MP4 download + ffprobe: runs only when E2E_RUN_RENDER=1
 *    (funded test account + live worker + provider APIs). Skipped otherwise.
 */

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100";
const isLocal = /localhost|127\.0\.0\.1/.test(BASE);
const PASSWORD = process.env.TEST_USER_PASSWORD ?? (isLocal ? `Stranger-${randomBytes(8).toString("hex")}!` : undefined);
const RUN_RENDER = process.env.E2E_RUN_RENDER === "1";

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  return errors;
}

test.describe("stranger: public site", () => {
  test("homepage loads with no console errors and key claims visible", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/");
    await expect(page).toHaveTitle(/Vidora/i);
    // Key marketing claims a stranger must see.
    await expect(page.getByText(/Script in\./).first()).toBeVisible();
    await expect(page.getByText(/16 built-in voices/).first()).toBeVisible();
    await expect(page.getByText(/1 credit = 1 finished minute/i).first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("pricing shows honest per-minute cost and checkout state", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByText(/\$19/)).toBeVisible();
    // Either checkout is live or the site honestly says it is not
    // (current copy: "Checkout is being set up").
    const body = await page.textContent("body");
    const honest =
      /checkout is being set up/i.test(body ?? "") || /coming soon/i.test(body ?? "");
    expect(honest).toBe(true);
  });
});

test.describe("stranger: signup + cost preview", () => {
  test.skip(
    !PASSWORD,
    "TEST_USER_PASSWORD not set and target is not localhost — refusing to create a prod account without explicit opt-in",
  );

  test("fresh timestamped signup lands in the studio", async ({ page }) => {
    const errors = collectErrors(page);
    const email = `stranger+${Date.now()}@vidoratube.test`;

    await page.goto("/auth");
    // Switch to signup mode.
    await page.getByRole("button", { name: /create an account/i }).click();
    await expect(page.getByRole("heading", { name: /create your studio/i })).toBeVisible();

    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/^password/i).fill(PASSWORD!);
    await page.getByRole("button", { name: /create account/i }).click();

    // Either we land in the studio (instant session) or Supabase asks for
    // email confirmation — both are legitimate, but only the first lets the
    // stranger continue.
    await expect(page).toHaveURL(/\/studio/, { timeout: 30_000 });
    await expect(page.getByText(/credits/i).first()).toBeVisible({ timeout: 15_000 });
    expect(errors).toEqual([]);
  });

  test("starting a render states the exact credit cost BEFORE rendering", async ({ page }) => {
    const email = `stranger+${Date.now()}@vidoratube.test`;
    await page.goto("/auth");
    await page.getByRole("button", { name: /create an account/i }).click();
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/^password/i).fill(PASSWORD!);
    await page.getByRole("button", { name: /create account/i }).click();
    await expect(page).toHaveURL(/\/studio/, { timeout: 30_000 });

    // Open the "make a video" page — cost must be stated before any render.
    // (?create=script renders GenerateVideoDialog asPage: a plain section
    // with an h1, not a modal dialog.)
    await page.goto("/studio?create=script");
    const heading = page.getByRole("heading", { name: /make a video/i });
    await expect(heading).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/1 credit = 1 finished minute/i).first()).toBeVisible();
    // The action button exists but we do NOT click it here.
    await expect(page.getByRole("button", { name: /generate video/i })).toBeVisible();
  });
});

test.describe("stranger: real render + download + ffprobe", () => {
  test.skip(
    !RUN_RENDER,
    "E2E_RUN_RENDER!=1 — a real render needs a funded test account, paid provider API calls, and a live render worker; refusing to spend money/credits by default",
  );
  test.skip(
    !PASSWORD,
    "TEST_USER_PASSWORD not set — cannot sign in to the funded test account",
  );

  test("small render completes, MP4 downloads, ffprobe confirms H.264 + AAC", async ({
    page,
  }) => {
    // Precondition: ffprobe must exist to verify the artifact.
    let hasFfprobe = true;
    try {
      execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    } catch {
      hasFfprobe = false;
    }
    test.skip(!hasFfprobe, "ffprobe not installed — cannot verify the downloaded MP4");

    const email = `stranger+${Date.now()}@vidoratube.test`;
    await page.goto("/auth");
    await page.getByRole("button", { name: /create an account/i }).click();
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/^password/i).fill(PASSWORD!);
    await page.getByRole("button", { name: /create account/i }).click();
    await expect(page).toHaveURL(/\/studio/, { timeout: 30_000 });

    await page.goto("/studio?create=script");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    // Minimal script so the render is small and cheap.
    await dialog.getByRole("textbox").first().fill("A calm lake at dawn. Birds sing.");
    const downloadPromise = page.waitForEvent("download", { timeout: 20 * 60_000 });
    await dialog.getByRole("button", { name: /generate video/i }).click();

    // The dialog flips to a "your video is ready" state with a Download MP4 link.
    await expect(dialog.getByText(/your video is ready/i)).toBeVisible({ timeout: 20 * 60_000 });
    await dialog.getByRole("link", { name: /download mp4/i }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();

    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0", path!],
      { encoding: "utf8" },
    );
    const codecs = out.trim().split("\n").map((s) => s.trim()).sort();
    expect(codecs).toContain("h264");
    expect(codecs).toContain("aac");
  });
});
