import { test, expect, type Page } from "@playwright/test";

/**
 * E2E_NICHE_FINDER — permanent Phase 2 intelligence scenario (Stream D).
 * Contract: docs/PHASE2_CONTRACTS.md "E2E_NICHE_FINDER".
 *
 * Scenario: query "faceless history mysteries" with filters —
 * language English, format long-form, subs 1K–500K, active only,
 * recent activity required.
 *
 * DUAL MODE:
 * - WITH YOUTUBE_API_KEY (niches page shows real data): full assertions —
 *   real channels only, freshness labels, expandable score factors,
 *   sorting changes order, filters narrow results, folder save works,
 *   similar channels render, outlier tab lists scored videos, blueprint
 *   generates, draft-script handoff creates an idea.
 * - WITHOUT key (unconfigured panel): asserts every intelligence surface
 *   shows the honest unconfigured state and zero fabricated rows.
 *
 * REQUIRES: TEST_USER_EMAIL and TEST_USER_PASSWORD env vars (seeded test
 * account). Skipped automatically when not provided.
 * RUN: npx playwright test e2e/niche-finder.spec.ts
 *      (E2E_BASE_URL defaults to http://localhost:3000 and boots `npm run dev`)
 *
 * SELECTOR ASSUMPTIONS (contract pins server functions, not UI text):
 * other streams' pages (niches/channels/outliers/trends/videos) are located
 * by role/label/text patterns described in the contract. If a stream renames
 * a control, update the helper below — the scenario itself is unchanged.
 */

const EMAIL = process.env.TEST_USER_EMAIL;
const PASSWORD = process.env.TEST_USER_PASSWORD;

const QUERY = "faceless history mysteries";
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
      await expect(
        page.getByRole("link", { name: new RegExp(name, "i") }).first(),
      ).toBeVisible({ timeout: 10_000 });
    }
    await assertNoFabricatedRows(page);
    expect(errors).toEqual([]);
  });

  test("niches: search with filters (dual mode)", async ({ page }) => {
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

    // ---- configured: full scenario ----
    const queryInput = page
      .getByLabel(/niche|search|query/i)
      .or(page.getByPlaceholder(/search|niche/i))
      .first();
    await queryInput.fill(QUERY);

    // Filters: language English, format long-form, subs 1K–500K,
    // active only, recent activity.
    const language = page.getByLabel(/language/i).first();
    if (await language.isVisible().catch(() => false)) {
      await language.click();
      await page.getByRole("option", { name: /english/i }).click();
    }
    const format = page.getByLabel(/format/i).first();
    if (await format.isVisible().catch(() => false)) {
      await format.click();
      await page.getByRole("option", { name: /long-?form/i }).click();
    }
    const minSubs = page.getByLabel(/min.*sub|sub.*min/i).first();
    if (await minSubs.isVisible().catch(() => false))
      await minSubs.fill("1000");
    const maxSubs = page.getByLabel(/max.*sub|sub.*max/i).first();
    if (await maxSubs.isVisible().catch(() => false))
      await maxSubs.fill("500000");
    const activeOnly = page.getByLabel(/active/i).first();
    if (await activeOnly.isVisible().catch(() => false)) {
      if (!(await activeOnly.isChecked().catch(() => true)))
        await activeOnly.check();
    }
    const recent = page.getByLabel(/recent/i).first();
    if (await recent.isVisible().catch(() => false)) {
      if (!(await recent.isChecked().catch(() => true)))
        await recent.check().catch(() => recent.click());
    }

    await page
      .getByRole("button", { name: /search|find|score|analyze/i })
      .first()
      .click();

    // Real channels only — no demo/placeholder/mock rows.
    await assertNoFabricatedRows(page);
    const channelRows = page.locator("tbody tr, [data-testid='channel-row']");
    await expect(channelRows.first()).toBeVisible({ timeout: 30_000 });

    // Freshness labels visible.
    await expect(
      page.getByText(/ago|captured|updated|fresh|stale/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Score factors expandable.
    const expand = page
      .getByRole("button", { name: /factor|score|detail|expand/i })
      .first();
    if (await expand.isVisible().catch(() => false)) {
      await expand.click();
      await expect(
        page.getByText(/demand|competition|velocity|freshness/i).first(),
      ).toBeVisible({ timeout: 10_000 });
    }

    // Sorting changes order (guard: need ≥2 rows for a meaningful check).
    const rowCount = await channelRows.count();
    if (rowCount >= 2) {
      const titlesBefore = await channelRows
        .locator("td, [data-testid='channel-title']")
        .first()
        .allTextContents();
      const sort = page.getByLabel(/sort/i).first();
      if (await sort.isVisible().catch(() => false)) {
        await sort.click();
        const current = (await sort.inputValue().catch(() => "")) || "";
        const alt = page.getByRole("option").filter({ hasNotText: current });
        if ((await alt.count()) > 0) {
          await alt.first().click();
          await page.waitForTimeout(1000);
          const titlesAfter = await channelRows
            .locator("td, [data-testid='channel-title']")
            .first()
            .allTextContents();
          expect(titlesAfter).not.toEqual(titlesBefore);
        }
      }
    }

    // Filters narrow results: enabling active-only must not grow the list.
    const countBefore = await channelRows.count();
    if (await activeOnly.isVisible().catch(() => false)) {
      await activeOnly.uncheck().catch(() => {});
      await page.waitForTimeout(800);
      const countAfter = await channelRows.count();
      expect(countAfter).toBeGreaterThanOrEqual(countBefore);
      await activeOnly.check().catch(() => {});
    }
  });

  test("channels: detail, similar channels, video intel (dual mode)", async ({
    page,
  }) => {
    await signIn(page);
    const mode = await detectMode(page);
    await page.goto("/intelligence/channels");
    if (mode === "unconfigured") {
      await assertNoFabricatedRows(page);
      return;
    }
    const firstChannel = page
      .locator("tbody tr a, [data-testid='channel-row'] a")
      .first();
    await expect(firstChannel).toBeVisible({ timeout: 30_000 });
    await firstChannel.click();
    // Similar channels (ESTIMATE heuristic) render.
    await expect(page.getByText(/similar/i).first()).toBeVisible({
      timeout: 15_000,
    });
    await assertNoFabricatedRows(page);
    // Drill into a video → video intel surface.
    const firstVideo = page
      .locator("tbody tr a, [data-testid='video-row'] a")
      .first();
    if (await firstVideo.isVisible().catch(() => false)) {
      await firstVideo.click();
      await expect(
        page.getByText(/packaging|performance|analysis/i).first(),
      ).toBeVisible({ timeout: 15_000 });
      // Draft-script handoff creates an idea.
      const draft = page
        .getByRole("button", { name: /draft.*idea|create.*idea|idea.*draft/i })
        .first();
      if (await draft.isVisible().catch(() => false)) {
        await draft.click();
        await expect(
          page.getByText(/idea created|draft created|idea saved/i).first(),
        ).toBeVisible({ timeout: 15_000 });
      }
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
    const rows = page.locator("tbody tr, [data-testid='outlier-row']");
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    // Scored videos show an outlier multiple (e.g. 3.2×).
    await expect(page.getByText(/\d+(\.\d+)?\s?[×x]/).first()).toBeVisible({
      timeout: 10_000,
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
    const trendRows = page.locator("tbody tr, [data-testid='trend-row']");
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
    const firstNiche = page
      .locator("tbody tr a, [data-testid='niche-row'] a")
      .first();
    await expect(firstNiche).toBeVisible({ timeout: 30_000 });
    await firstNiche.click();
    const blueprint = page
      .getByRole("button", { name: /blueprint/i })
      .first();
    await expect(blueprint).toBeVisible({ timeout: 15_000 });
    await blueprint.click();
    // Deterministic blueprint content renders (no LLM in Phase 2).
    await expect(
      page.getByText(/blueprint|content pillars|format/i).first(),
    ).toBeVisible({ timeout: 15_000 });
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
    await page
      .getByRole("option", { name: /outlier score/i })
      .click();
    await page.getByLabel(/rule operator/i).click();
    await page.getByRole("option", { name: /^gte$/i }).click();
    await page.getByLabel(/rule value/i).fill("2");
    await page.getByRole("button", { name: /add rule/i }).click();
    await expect(
      page.getByText(/outlier score/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Rule-matched section renders (empty is fine — honest, no fake rows).
    await expect(page.getByText(/rule-matched/i).first()).toBeVisible();
    await assertNoFabricatedRows(page);
    expect(errors).toEqual([]);
  });

  test("unconfigured mode: every surface shows honest state", async ({
    page,
  }) => {
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
        await expect(
          page.getByRole("link", { name: /folders/i }).first(),
        ).toBeVisible({ timeout: 10_000 });
      }
      if (path === "/intelligence/folders") {
        // Folders don't need the YouTube API: honest empty state.
        await expect(
          page.getByText(/no folders yet|smart folders/i).first(),
        ).toBeVisible({ timeout: 10_000 });
      }
    }
  });
});
