/**
 * Helpers for the deterministic-adapter E2E workflow specs (Phase 6, Stream A).
 *
 * The production app is served from `.output/server/index.mjs` with
 * `VIDORA_E2E_ADAPTER=deterministic`, and Supabase points at the local
 * deterministic stub (e2e/stub-supabase/server.mjs). These helpers drive the
 * real UI and inspect the stub's in-memory tables to assert REAL side
 * effects (credit_ledger rows, job status transitions, approval records).
 */

import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const STUB_URL = process.env.E2E_STUB_URL ?? "http://127.0.0.1:54321";
export const E2E_PASSWORD = "e2e-password-12345";

export function uniqueEmail(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}+${Date.now()}-${rand}@vidoratube.test`;
}

/** Collect pageerrors + console errors; assert at the end of the test. */
export function collectProblems(page: Page): {
  problems: string[];
  assertClean: () => void;
} {
  const problems: string[] = [];
  page.on("pageerror", (err) => problems.push(`[pageerror] ${String(err)}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(`[console.error] ${msg.text()}`);
  });
  return {
    problems,
    assertClean() {
      expect(problems, problems.join("\n")).toEqual([]);
    },
  };
}

/** Real signup through /auth — exercises the stub's GoTrue endpoints. */
export async function signUp(page: Page, email: string): Promise<void> {
  await page.goto("/auth");
  await page.getByRole("button", { name: /create an account/i }).click();
  await expect(page.getByRole("heading", { name: /create your studio/i })).toBeVisible();
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/^password$/i).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/studio/, { timeout: 30_000 });
}

/** Create a project through the real New-project dialog (real createProject server fn). */
export async function createProject(page: Page, topic: string): Promise<void> {
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: /projects/i }).first()).toBeVisible();
  await page.getByRole("button", { name: /new project/i }).first().click();
  // "New project" opens a mode chooser first; pick Script to Video.
  const chooser = page.getByRole("dialog", { name: /new project/i });
  await expect(chooser).toBeVisible();
  await chooser.getByRole("button", { name: /script to video/i }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByLabel(/topic/i) });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/topic/i).fill(topic);
  await dialog.getByRole("button", { name: /create project/i }).click();
  // The project card title is a link; the toast also mentions the topic, so
  // target the link to avoid ambiguity.
  await expect(page.getByRole("link", { name: topic })).toBeVisible({ timeout: 20_000 });
}

/* ------------------------------ localhost bridge ------------------------------ */

/**
 * Bridge loopback HTTP through Playwright route fulfillment.
 *
 * This VM's Chromium hard-blocks direct navigation to loopback addresses
 * (ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS) and no launch switch or
 * permission disables it. Worse, Chromium silently drops cross-origin
 * POST/OPTIONS from the page to the stub's own port before Playwright
 * routing ever sees them, so the deterministic stub cannot live on a
 * separate port from the page's perspective.
 *
 * Instead of fighting the browser, every request to the local app
 * (127.0.0.1:3100) is fulfilled with the REAL response fetched by the Node
 * side, which can reach loopback normally. Port 3100 is the E2E gateway
 * (e2e/serve.mjs): it forwards `/__e2e/supabase/*` to the deterministic
 * stub on 127.0.0.1:54321 and everything else to the production app, so ALL
 * browser traffic is same-origin and there are no cross-origin preflights
 * at all. The app code, server functions, and stub are all real — only the
 * last-mile transport is bridged. Public URLs pass through untouched (and
 * keep working via the configured egress proxy).
 *
 * Applied automatically to every page via e2e/fixtures.ts.
 */
export async function bridgeLocalhost(page: Page): Promise<void> {
  // Google Fonts are unreachable from this VM's Chromium through the egress
  // proxy (ERR_EMPTY_RESPONSE; curl works). Fonts are a static asset with
  // no bearing on workflow behavior, so answer them deterministically
  // instead of letting every page log console errors. Everything else
  // public passes through untouched.
  await page.route(/https:\/\/fonts\.googleapis\.com\/.*/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/css",
      body: "/* vidora e2e: font stylesheet stubbed for hermetic runs */",
    });
  });
  await page.route(/https:\/\/fonts\.gstatic\.com\/.*/, async (route) => {
    await route.fulfill({ status: 200, contentType: "font/woff2", body: Buffer.alloc(0) });
  });
  await page.route(/http:\/\/127\.0\.0\.1:3100\/.*/, async (route) => {
    const req = route.request();
    try {
      const headers: Record<string, string> = { ...req.headers() };
      delete headers["host"];
      const postData = req.postDataBuffer();
      const res = await fetch(req.url(), {
        method: req.method(),
        headers,
        body:
          req.method() === "GET" || req.method() === "HEAD"
            ? undefined
            : (postData ?? undefined),
        // Follow redirects on the Node side. Fulfilling a 3xx and letting
        // Chromium follow it trips this VM's local-network access check
        // (ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS), e.g. /thumbnails
        // 307s to /thumbnails?projectId=. The final content is what the
        // tests assert on; no E2E flow depends on observing the 3xx itself.
      });
      const respHeaders: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        if (key === "content-encoding" || key === "content-length" || key === "transfer-encoding") {
          return;
        }
        respHeaders[key] = value;
      });
      await route.fulfill({
        status: res.status,
        headers: respHeaders,
        body: Buffer.from(await res.arrayBuffer()),
      });
    } catch {
      await route.abort("failed");
    }
  });
}

/* ------------------------------ stub client ------------------------------ */

function qs(params: Record<string, string | number>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) sp.set(k, String(v));
  return sp.toString();
}

/** GET /rest/v1/<table> against the stub. */
export async function stubSelect(
  request: APIRequestContext,
  table: string,
  params: Record<string, string | number> = {},
): Promise<any[]> {
  const res = await request.get(`${STUB_URL}/rest/v1/${table}?${qs(params)}`, {
    headers: { Accept: "application/json" },
  });
  expect(res.ok(), `stub select ${table} failed: ${res.status()}`).toBeTruthy();
  return (await res.json()) as any[];
}

/** POST /rest/v1/<table> against the stub (insert). */
export async function stubInsert(
  request: APIRequestContext,
  table: string,
  rows: unknown,
): Promise<any[]> {
  const res = await request.post(`${STUB_URL}/rest/v1/${table}`, {
    headers: { Accept: "application/json", Prefer: "return=representation" },
    data: rows,
  });
  expect(res.ok(), `stub insert ${table} failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as any[];
}

/** POST /rest/v1/rpc/<fn> against the stub. */
export async function stubRpc(
  request: APIRequestContext,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const res = await request.post(`${STUB_URL}/rest/v1/rpc/${fn}`, {
    headers: { Accept: "application/json" },
    data: args,
  });
  expect(res.ok(), `stub rpc ${fn} failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

/** Resolve the stub-side user id for an email (signup is deterministic). */
export async function stubUserId(request: APIRequestContext, email: string): Promise<string> {
  const res = await request.get(`${STUB_URL}/e2e/users?email=${encodeURIComponent(email)}`);
  expect(res.ok()).toBeTruthy();
  const list = (await res.json()) as { id: string }[];
  expect(list.length, `expected exactly one stub user for ${email}`).toBe(1);
  return list[0]!.id;
}

/** Current credit balance for a user id (real profiles row). */
export async function stubCredits(request: APIRequestContext, userId: string): Promise<number> {
  const rows = await stubSelect(request, "profiles", { id: `eq.${userId}`, select: "credits" });
  expect(rows.length).toBe(1);
  return rows[0].credits as number;
}

/** credit_ledger rows for a user, newest first. */
export async function stubLedger(
  request: APIRequestContext,
  userId: string,
): Promise<{ delta: number; reason: string; ref_id: string | null }[]> {
  return (await stubSelect(request, "credit_ledger", {
    user_id: `eq.${userId}`,
    select: "delta,reason,ref_id,created_at",
    order: "created_at.desc",
  })) as { delta: number; reason: string; ref_id: string | null }[];
}

/** Wait until a predicate over stub rows succeeds (polls via page.request). */
export async function waitForStub(
  request: APIRequestContext,
  table: string,
  params: Record<string, string | number>,
  predicate: (rows: any[]) => boolean,
  timeoutMs = 20_000,
): Promise<any[]> {
  const start = Date.now();
  for (;;) {
    const rows = await stubSelect(request, table, params);
    if (predicate(rows)) return rows;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitForStub timed out for ${table} ${JSON.stringify(params)}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}
