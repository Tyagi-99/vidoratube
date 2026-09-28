/**
 * Critical workflow E2E tests (Phase 6, Stream A).
 *
 * Runs against the PRODUCTION build with deterministic adapters:
 *   - Supabase -> local deterministic stub (e2e/stub-supabase/server.mjs)
 *   - AI script generation -> deterministic adapter inside
 *     generateScriptDraft (VIDORA_E2E_ADAPTER=deterministic), which returns
 *     canned topic-derived sections with no provider call.
 *
 * Everything else is the real app: real UI, real server functions, real
 * credit preflight/debit/refund RPCs, real job status transitions, and real
 * credit_ledger rows asserted via the stub.
 *
 * Labels: "[adapter]" marks tests that only pass with the deterministic
 * adapters, per the frozen-stack / honest-testing rules.
 */

import { expect, test } from "./fixtures";
import { allNavTargets } from "../src/components/vidora/appNav";
import {
  collectProblems,
  createProject,
  signUp,
  STUB_URL,
  stubCredits,
  stubInsert,
  stubLedger,
  stubSelect,
  stubUserId,
  uniqueEmail,
  waitForStub,
} from "./adapter-helpers";

test.describe.configure({ mode: "serial" });

test("[adapter] signup -> project creation", async ({ page }) => {
  const { assertClean } = collectProblems(page);
  const email = uniqueEmail("flow-signup");

  // signup: real /auth UI -> stub GoTrue -> redirect /studio
  await signUp(page, email);

  // studio loads (signed in)
  await expect(page.getByText(/vidora studio|studio/i).first()).toBeVisible();

  // new project via the real dialog -> real createProject server fn
  const topic = "The Lost Colony of Roanoke";
  await createProject(page, topic);

  // project exists in the stub DB with the topic
  const userId = await stubUserId(page.request, email);
  const projects = await stubSelect(page.request, "projects", {
    user_id: `eq.${userId}`,
    select: "id,title,topic,status",
  });
  expect(projects.length).toBeGreaterThanOrEqual(1);
  expect(projects.some((p) => String(p.title ?? p.topic ?? "").includes("Roanoke"))).toBeTruthy();

  assertClean();
});

test("[adapter] idea -> script generation debits 1 credit and writes a ledger row", async ({
  page,
}) => {
  const { assertClean } = collectProblems(page);
  const email = uniqueEmail("flow-script");
  await signUp(page, email);
  const userId = await stubUserId(page.request, email);

  const balanceBefore = await stubCredits(page.request, userId);
  expect(balanceBefore).toBe(50);

  const topic = "Why do we dream?";
  await createProject(page, topic);

  // open the project detail page (ScriptStudio lives there)
  await page.getByText(topic).first().click();
  await expect(page).toHaveURL(/\/projects\//, { timeout: 20_000 });

  // ScriptStudio requires a script row before the AI-draft UI appears:
  // click "New script", then drive the real topic + Generate draft controls
  // (the topic input's Label is not htmlFor-linked, so find it by placeholder).
  const newScriptBtn = page.getByRole("button", { name: /^new script$/i });
  await newScriptBtn.scrollIntoViewIfNeeded();
  await newScriptBtn.click();
  const topicInput = page.getByPlaceholder(/why airplane windows/i);
  await topicInput.scrollIntoViewIfNeeded();
  await topicInput.fill("Why do we dream?");
  await page.getByRole("button", { name: /generate draft/i }).click();

  // deterministic adapter returns canned sections quickly; wait for them
  await expect(page.getByText("AI draft ready", { exact: false })).toBeVisible({ timeout: 30_000 });

  // assert a REAL debit: 1 credit down and a negative credit_ledger row
  const balanceAfter = await stubCredits(page.request, userId);
  expect(balanceAfter).toBe(balanceBefore - 1);

  const ledger = await stubLedger(page.request, userId);
  const debit = ledger.find((r) => r.delta < 0 && r.reason.includes("script"));
  expect(debit, `expected a script debit ledger row; got ${JSON.stringify(ledger)}`).toBeTruthy();
  expect(debit!.delta).toBe(-1);

  // assert a real script version was persisted
  const versions = await stubSelect(page.request, "script_versions", {
    select: "version_number,sections",
  });
  expect(versions.length).toBeGreaterThanOrEqual(1);

  assertClean();
});

test("[adapter] publishing approval: approve path writes approval records", async ({ page }) => {
  const { assertClean } = collectProblems(page);
  const email = uniqueEmail("flow-approve");
  await signUp(page, email);
  const userId = await stubUserId(page.request, email);

  const topic = "The Library of Alexandria";
  await createProject(page, topic);
  const [project] = await stubSelect(page.request, "projects", {
    user_id: `eq.${userId}`,
    select: "id",
    limit: 1,
  });

  // seed a draft publish job (as the producer UI would have created it)
  const [job] = await stubInsert(page.request, "publish_jobs", {
    user_id: userId,
    project_id: project.id,
    status: "draft",
    title: "Alexandria draft",
  });

  // drive the real review UI
  await page.goto("/publish/review");
  await page.getByText(job.title).first().click();
  await expect(page.getByRole("heading", { name: /review/i }).first()).toBeVisible({
    timeout: 20_000,
  });

  await page.getByRole("button", { name: /^approve$/i }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/title/i).fill("Alexandria — final");
  await dialog.getByRole("button", { name: /approve job/i }).click();

  await expect(page.getByText(/job approved/i)).toBeVisible({ timeout: 20_000 });

  // assert the REAL server-side transitions: job approved + approval record
  const jobs = await waitForStub(
    page.request,
    "publish_jobs",
    { id: `eq.${job.id}`, select: "status,title" },
    (rows) => rows[0]?.status === "approved",
  );
  expect(jobs[0].title).toBe("Alexandria — final");

  const approvals = await stubSelect(page.request, "approvals", {
    publish_job_id: `eq.${job.id}`,
    select: "approver_id,scope",
  });
  expect(approvals.length).toBeGreaterThanOrEqual(1);
  expect(approvals[0].approver_id).toBe(userId);
  expect(approvals[0].scope).toMatch(/^youtube-/);

  assertClean();
});

test("[adapter] publishing approval: reject path cancels the job with a reason", async ({
  page,
}) => {
  const { assertClean } = collectProblems(page);
  const email = uniqueEmail("flow-reject");
  await signUp(page, email);
  const userId = await stubUserId(page.request, email);

  const topic = "The Voynich Manuscript";
  await createProject(page, topic);
  const [project] = await stubSelect(page.request, "projects", {
    user_id: `eq.${userId}`,
    select: "id",
    limit: 1,
  });

  const [job] = await stubInsert(page.request, "publish_jobs", {
    user_id: userId,
    project_id: project.id,
    status: "draft",
    title: "Voynich draft",
  });

  await page.goto("/publish/review");
  await page.getByText(job.title).first().click();
  await expect(page.getByRole("heading", { name: /review/i }).first()).toBeVisible({
    timeout: 20_000,
  });

  await page.getByRole("button", { name: /^reject$/i }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const reason = "Script cites an unverified translation — needs sources";
  await dialog.getByLabel(/reason/i).fill(reason);
  await dialog.getByRole("button", { name: /reject and cancel/i }).click();

  await expect(page.getByText(/job rejected and canceled/i)).toBeVisible({ timeout: 20_000 });

  // assert the REAL server-side transition: canceled + audit trail.
  // (The reason is stored in the audit row's metadata, not on the job —
  // rejectPublishJob only flips status on publish_jobs.)
  const jobs = await waitForStub(
    page.request,
    "publish_jobs",
    { id: `eq.${job.id}`, select: "status" },
    (rows) => rows[0]?.status === "canceled",
  );
  expect(jobs[0].status).toBe("canceled");

  const audits = await stubSelect(page.request, "audit_logs", {
    action: "eq.publish.rejected",
    select: "action,entity_id,metadata",
    order: "created_at.desc",
    limit: 10,
  });
  const mine = audits.find((a) => String(a.entity_id) === String(job.id));
  expect(mine, `expected a publish.rejected audit row; got ${JSON.stringify(audits)}`).toBeTruthy();
  expect(mine!.metadata?.reason).toBe(reason);

  assertClean();
});

test("[adapter] stale render reap refunds credits and writes a ledger row", async ({ page }) => {
  const { assertClean } = collectProblems(page);
  const email = uniqueEmail("flow-refund");
  await signUp(page, email);
  const userId = await stubUserId(page.request, email);

  // 1. seed a stale "running" video job first (the reaper refunds the debit
  // whose credit_ledger.ref_id equals the JOB id, and only reaps jobs whose
  // updated_at is older than REAP_AFTER_MS = 30 min)
  const [job] = await stubInsert(page.request, "video_jobs", {
    user_id: userId,
    project_id: null,
    status: "running",
    stage: "rendering",
    mode: "story",
    credit_minutes: 5,
    started_at: new Date(Date.now() - 60 * 60_000).toISOString(),
    updated_at: new Date(Date.now() - 60 * 60_000).toISOString(),
  });

  // 2. debit 5 credits for that render job (real RPC, real ledger row)
  const debitRes = await page.request.post(`${STUB_URL}/rest/v1/rpc/debit_credits_for_minutes`, {
    data: { p_user_id: userId, p_minutes: 5, p_reason: "video render", p_ref_id: job.id },
  });
  expect(debitRes.ok()).toBeTruthy();
  expect(await stubCredits(page.request, userId)).toBe(45);

  // 3. visit /studio: the real reaper runs on first visit and refunds the debit
  await page.goto("/studio");
  await expect(page.getByText(/vidora studio|studio/i).first()).toBeVisible();

  const jobs = await waitForStub(
    page.request,
    "video_jobs",
    { id: `eq.${job.id}`, select: "status,error" },
    (rows) => rows[0]?.status === "failed",
    30_000,
  );
  expect(jobs[0].status).toBe("failed");

  // 4. assert the REAL refund: balance restored + positive ledger row
  expect(await stubCredits(page.request, userId)).toBe(50);
  const ledger = await stubLedger(page.request, userId);
  const refund = ledger.find((r) => r.delta > 0 && r.ref_id === job.id);
  expect(refund, `expected a refund ledger row; got ${JSON.stringify(ledger)}`).toBeTruthy();
  expect(refund!.delta).toBe(5);

  assertClean();
});

test("every nav target loads without errors or blank output", async ({ page }) => {
  const email = uniqueEmail("flow-nav");
  await signUp(page, email);

  const failures: string[] = [];
  for (const target of allNavTargets) {
    const problems: string[] = [];
    const onErr = (err: Error) => problems.push(`[pageerror] ${String(err)}`);
    const onConsole = (msg: { type: () => string; text: () => string }) => {
      if (msg.type() === "error") problems.push(`[console.error] ${msg.text()}`);
    };
    page.on("pageerror", onErr);
    page.on("console", onConsole);
    try {
      const res = await page.goto(target, { waitUntil: "domcontentloaded", timeout: 20_000 });
      expect(res, `${target} returned no response`).not.toBeNull();
      expect(res!.status(), `${target} returned HTTP ${res!.status()}`).toBeLessThan(500);
      // wait for the app shell to render content (production hydration)
      await page.waitForFunction(
        () => document.body.innerText.trim().length > 50 || document.querySelector("[data-error-boundary]"),
        { timeout: 20_000 },
      );
      const text = (await page.evaluate(() => document.body.innerText)).trim();
      if (text.length <= 50) failures.push(`${target}: blank page (no meaningful text)`);
      const boundary = await page.evaluate(() => document.querySelector("[data-error-boundary]"));
      if (boundary) failures.push(`${target}: error boundary rendered`);
      if (problems.length > 0) failures.push(`${target}: ${problems.join("; ")}`);
    } catch (e) {
      failures.push(`${target}: ${(e as Error).message.split("\n")[0]}`);
    } finally {
      page.off("pageerror", onErr);
      page.off("console", onConsole);
    }
  }
  expect(failures, failures.join("\n")).toEqual([]);
});
