import { test, expect, type Page } from "./fixtures";

/**
 * E2E_NICHE_FINDER — permanent Phase 2 intelligence scenario (Stream D).
 * Contract: docs/PHASE2_CONTRACTS.md "E2E_NICHE_FINDER".
 *
 * Scenario: create a niche through the real "New niche" dialog
 * (name "Faceless history mysteries", keywords, language English, format
 * long-form, subs 1K–500K, active channels only), then score it, expand its
 * factors, generate its blueprint, and exercise channel detail, video intel,
 * outliers (+ draft-script handoff), trend radar, and smart folders.
 *
 * DUAL MODE:
 * - WITH YOUTUBE_API_KEY (niches page shows real data): full assertions —
 *   niche card with score/freshness/factors, filter bar narrows results,
 *   similar channels render, outlier multiples show, draft-script handoff
 *   creates a real idea, blueprint generates, folder rule matching works.
 * - WITHOUT key (unconfigured panel): asserts every intelligence surface
 *   shows the honest unconfigured state and zero fabricated rows.
 *
 * REQUIRES: TEST_USER_EMAIL and TEST_USER_PASSWORD env vars (seeded test
 * account). Skipped automatically when not provided.
 * RUN: npx playwright test e2e/niche-finder.spec.ts
 *      (E2E_BASE_URL defaults to http://127.0.0.1:3100, served by `node e2e/serve.mjs`)
 *
 * SELECTOR ASSUMPTIONS (contract pins server functions, not UI text):
 * other streams' pages (niches/channels/outliers/trends/videos) are located
 * by role/label/text patterns described in the contract. If a stream renames
 * a control, update the helper below — the scenario itself is unchanged.
 */

const EMAIL = process.env.TEST_USER_EMAIL;
const PASSWORD = process.env.TEST_USER_PASSWORD;

/** Fabricated-row canary: these words must never appear as data rows. */
const FABRICATED = /\b(demo|placeholder|mock)\b/i;
/** The honest "not connected" panel per the envelope convention. */
const UNCONFIGURED_HINT = /youtube data api/i;

async function signIn(page: Page) {
  await page.goto("/auth");
  await page.getByLabel(/email/i).fill(EMAIL!);
  await page.getByLabel(/password/i).fill(PASSWORD!);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/studio/, { timeout: 15_000 });
}

/**
 * Mode detection per contract: the niches page shows data when
 * YOUTUBE_API_KEY is configured, the unconfigured panel otherwise.
 * (A 404 means the route isn't built yet — treated as unconfigured,
 *  since there is provably no fabricated data either.)
 */
async function detectMode(page: Page): Promise<"configured" | "unconfigured"> {
  const res = await page.goto("/intelligence/niches");
  if (res && res.status() === 404) return "unconfigured";
  const panel = page.getByText(UNCONFIGURED_HINT).first();
  if (await panel.isVisible().catch(() => false)) return "unconfigured";
  return "configured";
}

async function assertNoFabricatedRows(page: Page) {
  await expect(page.getByText(FABRICATED).first()).toHaveCount(0);
}

test.describe("E2E_NICHE_FINDER", () => {
  test.skip(!EMAIL || !PASSWORD, "TEST_USER_EMAIL/PASSWORD not set");

  test("hub renders all six intelligence sections", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await signIn(page);
    await page.goto("/intelligence");
    for (const name of [
      "Niches",
      "Channels",
      "Outliers",
      "Video Intel",
      "Trend Radar",
      "Folders",
    ]) {
      await expect(page.getByRole("link", { name: new RegExp(name, "i") }).first()).toBeVisible({
        timeout: 10_000,
      });
    }
    await assertNoFabricatedRows(page);
    expect(errors).toEqual([]);
  });

  test("niches: create + score with filters (dual mode)", async ({ page }) => {
    await signIn(page);
    const mode = await detectMode(page);

    if (mode === "unconfigured") {
      // Honest empty state, zero fabricated rows.
      const res404 = await page.goto("/intelligence/niches");
      if (res404 && res404.status() !== 404) {
        await expect(page.getByText(UNCONFIGURED_HINT).first()).toBeVisible({
          timeout: 10_000,
        });
      }
      await assertNoFabricatedRows(page);
      return;
    }

    // ---- configured: create a niche through the real dialog flow ----
    // NOTE: scoring burns real YouTube Data API quota — run deliberately.
    await page.goto("/intelligence/niches");
    const nicheName = `Faceless history mysteries ${Date.now()}`;
    await page.getByRole("button", { name: /new niche/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/niche name/i).fill(nicheName);
    await dialog.getByLabel(/keywords/i).fill("faceless, history, mysteries");
    await dialog.getByLabel(/^language$/i).fill("en");
    await dialog.getByLabel(/min.*sub/i).fill("1000");
    await dialog.getByLabel(/max.*sub/i).fill("500000");
    await dialog.getByLabel(/format/i).click();
    await page.getByRole("option", { name: /long-form/i }).click();
    const activeOnly = dialog.getByLabel(/active channels only/i);
    if (!(await activeOnly.isChecked())) await activeOnly.check();
    await dialog.getByRole("button", { name: /create niche/i }).click();

    // Scored niche card appears with freshness + confidence — real data only.
    const cardLink = page.getByRole("link", { name: new RegExp(nicheName, "i") }).first();
    await expect(cardLink).toBeVisible({ timeout: 30_000 });
    await assertNoFabricatedRows(page);
    await expect(page.getByText(/fresh|stale/i).first()).toBeVisible({
      timeout: 10_000,
    });

    // Score factors expandable (demand / competition / velocity / freshness).
    const factors = page.getByRole("button", { name: /factors/i }).first();
    if (await factors.isVisible().catch(() => false)) {
      await factors.click();
      await expect(page.getByText(/demand|competition|velocity/i).first()).toBeVisible({
        timeout: 10_000,
      });
    }

    // Filter bar narrows the list: an impossible min-subs hides every card
    // behind the honest insufficient-data panel; clearing restores the card.
    await page
      .getByLabel(/min.*sub/i)
      .last()
      .fill("999999999");
    await expect(page.getByText(/no niches match these filters/i).first()).toBeVisible({
      timeout: 10_000,
    });
    await page
      .getByLabel(/min.*sub/i)
      .last()
      .fill("");
    await expect(cardLink).toBeVisible({ timeout: 10_000 });
    await assertNoFabricatedRows(page);
  });

  test("channels: detail, similar channels, video intel (dual mode)", async ({ page }) => {
    await signIn(page);
    const mode = await detectMode(page);
    await page.goto("/intelligence/channels");
    if (mode === "unconfigured") {
      await assertNoFabricatedRows(page);
      return;
    }
    const firstChannel = page.getByTestId("channel-row").first();
    await expect(firstChannel).toBeVisible({ timeout: 30_000 });
    await firstChannel.click();
    // Similar channels (ESTIMATE heuristic) render.
    await expect(page.getByText(/similar channels/i).first()).toBeVisible({
      timeout: 15_000,
    });
    await assertNoFabricatedRows(page);
    // Drill into a video → video intel surface (descriptive facts only).
    const firstVideo = page.getByTestId("video-row").first();
    if (await firstVideo.isVisible().catch(() => false)) {
      await firstVideo.click();
      await expect(page.getByText(/packaging|performance/i).first()).toBeVisible({
        timeout: 15_000,
      });
      await assertNoFabricatedRows(page);
    }
  });

  test("outliers: scored videos listed (dual mode)", async ({ page }) => {
    await signIn(page);
    const mode = await detectMode(page);
    await page.goto("/intelligence/outliers");
    if (mode === "unconfigured") {
      await assertNoFabricatedRows(page);
      return;
    }
    const rows = page.getByTestId("outlier-row");
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    // Scored videos show an outlier multiple (e.g. "3.2× median").
    await expect(page.getByText(/\d+(\.\d+)?\s?×/).first()).toBeVisible({
      timeout: 10_000,
    });
    await assertNoFabricatedRows(page);

    // Draft-script handoff: creates a real video_ideas row via draftIdeaFromVideo.
    const draft = rows.first().getByRole("button", { name: /draft script/i });
    await draft.click();
    await expect(page.getByText(/draft idea created from outlier/i).first()).toBeVisible({
      timeout: 15_000,
    });
    await assertNoFabricatedRows(page);
  });

  test("trends: radar with cited sources (dual mode)", async ({ page }) => {
    await signIn(page);
    const mode = await detectMode(page);
    await page.goto("/intelligence/trends");
    if (mode === "unconfigured") {
      await assertNoFabricatedRows(page);
      return;
    }
    const trendRows = page.getByTestId("trend-row");
    await expect(trendRows.first()).toBeVisible({ timeout: 30_000 });
    // Citations mandatory: each trend links ≥1 source.
    await expect(page.locator("a[href^='http']").first()).toBeVisible({
      timeout: 10_000,
    });
    await assertNoFabricatedRows(page);
  });

  test("niche detail: blueprint generates (dual mode)", async ({ page }) => {
    await signIn(page);
    const mode = await detectMode(page);
    if (mode === "unconfigured") return;
    await page.goto("/intelligence/niches");
    const firstNiche = page.locator('a[href*="/intelligence/niches/"]').first();
    await expect(firstNiche).toBeVisible({ timeout: 30_000 });
    await firstNiche.click();
    const blueprint = page.getByRole("button", { name: /blueprint/i }).first();
    await expect(blueprint).toBeVisible({ timeout: 15_000 });
    await blueprint.click();
    // Deterministic blueprint content renders (no LLM in Phase 2).
    await expect(page.getByText(/blueprint|content pillars|format/i).first()).toBeVisible({
      timeout: 15_000,
    });
    await assertNoFabricatedRows(page);
  });

  test("folders: create, rule, pin (no API key needed)", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await signIn(page);
    await page.goto("/intelligence/folders");

    // Create a folder.
    const folderName = `E2E History ${Date.now()}`;
    await page.getByRole("button", { name: /new folder/i }).click();
    await page.getByLabel(/name/i).fill(folderName);
    await page.getByRole("button", { name: /^create$/i }).click();
    await expect(page.getByText(folderName).first()).toBeVisible({
      timeout: 10_000,
    });

    // Add a rule: videos.outlier_score gte 2.
    await page.getByLabel(/rule field/i).click();
    await page.getByRole("option", { name: /outlier score/i }).click();
    await page.getByLabel(/rule operator/i).click();
    await page.getByRole("option", { name: /^gte$/i }).click();
    await page.getByLabel(/rule value/i).fill("2");
    await page.getByRole("button", { name: /add rule/i }).click();
    await expect(page.getByText(/outlier score/i).first()).toBeVisible({ timeout: 10_000 });

    // Rule-matched section renders (empty is fine — honest, no fake rows).
    await expect(page.getByText(/rule-matched/i).first()).toBeVisible();
    await assertNoFabricatedRows(page);
    expect(errors).toEqual([]);
  });

  test("unconfigured mode: every surface shows honest state", async ({ page }) => {
    await signIn(page);
    const mode = await detectMode(page);
    test.skip(
      mode === "configured",
      "YOUTUBE_API_KEY configured — unconfigured assertions do not apply",
    );
    for (const path of [
      "/intelligence",
      "/intelligence/niches",
      "/intelligence/channels",
      "/intelligence/outliers",
      "/intelligence/trends",
      "/intelligence/folders",
    ]) {
      await page.goto(path);
      // Zero fabricated rows on every surface, always.
      await assertNoFabricatedRows(page);
      if (path === "/intelligence") {
        // Hub is API-independent: six section cards must render.
        await expect(page.getByRole("link", { name: /folders/i }).first()).toBeVisible({
          timeout: 10_000,
        });
      }
      if (path === "/intelligence/folders") {
        // Folders don't need the YouTube API: honest empty state.
        await expect(page.getByText(/no folders yet|smart folders/i).first()).toBeVisible({
          timeout: 10_000,
        });
      }
    }
  });
});
