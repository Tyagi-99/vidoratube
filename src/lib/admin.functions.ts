import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "./admin.server";

export const adminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const [users, jobs, completed, messages, plans, integrations] = await Promise.all([
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("video_jobs").select("id", { count: "exact", head: true }),
      supabase.from("video_jobs").select("id", { count: "exact", head: true }).eq("status", "completed"),
      supabase.from("contact_messages").select("id", { count: "exact", head: true }).eq("handled", false),
      supabase.from("pricing_plans").select("id", { count: "exact", head: true }).eq("active", true),
      supabase.from("integrations").select("id", { count: "exact", head: true }).eq("enabled", true),
    ]);

    const { data: recentJobs } = await supabase
      .from("video_jobs")
      .select("id, title, status, created_at, user_id, credits_used")
      .order("created_at", { ascending: false })
      .limit(8);

    return {
      users: users.count ?? 0,
      jobs: jobs.count ?? 0,
      completed: completed.count ?? 0,
      openMessages: messages.count ?? 0,
      activePlans: plans.count ?? 0,
      liveIntegrations: integrations.count ?? 0,
      recentJobs: recentJobs ?? [],
    };
  });

/**
 * Render-worker health for the admin dashboard.
 *
 * Reads the latest worker_heartbeats row through the service role
 * (authenticated clients have no RLS policy on that table — worker
 * infrastructure is not user data) plus the server-render queue depth
 * broken into queued / running / stale. Stale = queued for over an hour
 * or running for over two hours (see STALE_* in worker-health.ts).
 */
export const adminWorkerStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { workerHealthStatus, STALE_QUEUED_MS, STALE_RUNNING_MS } = await import(
      "./worker-health"
    );

    const now = Date.now();
    const queuedCutoff = new Date(now - STALE_QUEUED_MS).toISOString();
    const runningCutoff = new Date(now - STALE_RUNNING_MS).toISOString();

    const [beatRes, queuedRes, runningRes, staleQueuedRes, staleRunningRes] = await Promise.all([
      supabaseAdmin
        .from("worker_heartbeats")
        .select("worker_id,last_seen_at")
        .order("last_seen_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("renders")
        .select("id", { count: "exact", head: true })
        .eq("engine", "server_ffmpeg")
        .eq("status", "queued"),
      supabaseAdmin
        .from("renders")
        .select("id", { count: "exact", head: true })
        .eq("engine", "server_ffmpeg")
        .eq("status", "running"),
      supabaseAdmin
        .from("renders")
        .select("id", { count: "exact", head: true })
        .eq("engine", "server_ffmpeg")
        .eq("status", "queued")
        .lt("created_at", queuedCutoff),
      supabaseAdmin
        .from("renders")
        .select("id", { count: "exact", head: true })
        .eq("engine", "server_ffmpeg")
        .eq("status", "running")
        .lt("claimed_at", runningCutoff),
    ]);
    for (const res of [beatRes, queuedRes, runningRes, staleQueuedRes, staleRunningRes]) {
      if (res.error) throw new Error(res.error.message);
    }

    const beat = beatRes.data;
    return {
      workerId: beat?.worker_id ?? null,
      lastSeenAt: beat?.last_seen_at ?? null,
      status: workerHealthStatus(beat?.last_seen_at ?? null, now),
      queued: queuedRes.count ?? 0,
      running: runningRes.count ?? 0,
      stale: (staleQueuedRes.count ?? 0) + (staleRunningRes.count ?? 0),
    };
  });

export type UnitEconomicsPlan = {
  slug: string;
  name: string;
  kind: string;
  credits: number;
  priceUsd: number;
  /** USD revenue per credit, null when the plan has no price. */
  revenuePerCredit: number | null;
  /** Gross margin vs measured provider cost, null when there is no measured data. */
  grossMargin: number | null;
};

export type UnitEconomics = {
  hasData: boolean;
  /** Total measured provider cost in USD (api_usage.estimated_cost). */
  totalCostUsd: number;
  /** ISO date from which costs have been recorded, null when tracking hasn't started. */
  costsSince: string | null;
  usageCalls: number;
  costByProvider: Record<string, number>;
  totalFinishedMinutes: number;
  minutesByMode: Record<string, number>;
  /** Measured USD cost per finished minute, null without data. */
  costPerMinuteUsd: number | null;
  renderCreditsCharged: number;
  /** Measured USD cost per credit charged, null without data. */
  costPerCreditUsd: number | null;
  plans: UnitEconomicsPlan[];
};

/**
 * Unit economics for the admin dashboard.
 *
 * Measured (never estimated-from-nothing) numbers:
 *   - provider cost: SUM(api_usage.estimated_cost) — real recorded costs in USD
 *   - finished minutes: completed `renders` rows (duration in seconds → minutes, rounded up)
 *   - cost per finished minute (overall + per cost mode from renders.meta)
 *   - per-plan gross margin: plan price vs measured cost per credit
 *
 * When there is no real data yet, hasData is false and the UI shows the
 * honest empty state ("No measured data yet — costs are recorded from
 * <date>") instead of zeros presented as measurements.
 */
export const adminUnitEconomics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<UnitEconomics> => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { PLANS } = await import("./billing/plans");
    const { finishedMinutes } = await import("./billing/per-minute");

    const [usageRes, rendersRes, ledgerRes] = await Promise.all([
      supabaseAdmin.from("api_usage").select("provider,estimated_cost,created_at").limit(10000),
      supabaseAdmin.from("renders").select("duration,meta").eq("status", "completed").limit(10000),
      supabaseAdmin
        .from("credit_ledger")
        .select("delta")
        .lt("delta", 0)
        .ilike("reason", "%render%")
        .limit(10000),
    ]);
    if (usageRes.error) throw new Error(usageRes.error.message);
    if (rendersRes.error) throw new Error(rendersRes.error.message);
    if (ledgerRes.error) throw new Error(ledgerRes.error.message);

    // 1. Measured provider costs (USD).
    const usageRows = usageRes.data ?? [];
    const totalCostUsd = usageRows.reduce((s, r) => s + Number(r.estimated_cost ?? 0), 0);
    const costedRows = usageRows.filter((r) => Number(r.estimated_cost ?? 0) > 0);
    const costsSince =
      costedRows.length > 0
        ? costedRows.map((r) => r.created_at as string).sort()[0]!
        : null;
    const costByProvider: Record<string, number> = {};
    for (const r of usageRows) {
      costByProvider[r.provider] = (costByProvider[r.provider] ?? 0) + Number(r.estimated_cost ?? 0);
    }

    // 2. Finished minutes from completed renders, grouped by billing mode.
    // Rows without a usable duration are skipped — never guessed. The mode
    // is written by buildServerRenderRows from the enqueue input (Sprint 1
    // billing-mode attribution); rows predating it read as "untracked".
    const minutesByMode: Record<string, number> = {};
    let totalFinishedMinutes = 0;
    for (const r of rendersRes.data ?? []) {
      const seconds = Number(r.duration);
      if (!Number.isFinite(seconds) || seconds <= 0) continue;
      const mins = finishedMinutes(seconds);
      const mode =
        (r.meta as { mode?: string } | null)?.mode ?? "untracked";
      minutesByMode[mode] = (minutesByMode[mode] ?? 0) + mins;
      totalFinishedMinutes += mins;
    }

    // 3. Credits actually charged for renders (negative ledger deltas whose
    // reason mentions a render). Refunds have positive deltas and are excluded.
    const renderCreditsCharged = (ledgerRes.data ?? []).reduce(
      (s, r) => s + Math.abs(Number(r.delta)),
      0,
    );

    const hasData = totalCostUsd > 0 && totalFinishedMinutes > 0;
    const costPerMinuteUsd = hasData ? totalCostUsd / totalFinishedMinutes : null;
    const costPerCreditUsd =
      totalCostUsd > 0 && renderCreditsCharged > 0 ? totalCostUsd / renderCreditsCharged : null;

    const plans: UnitEconomicsPlan[] = PLANS.map((p) => {
      const priceUsd = (p.priceUsdCents ?? 0) / 100;
      const revenuePerCredit = p.credits > 0 && priceUsd > 0 ? priceUsd / p.credits : null;
      const grossMargin =
        revenuePerCredit != null && costPerCreditUsd != null && revenuePerCredit > 0
          ? (revenuePerCredit - costPerCreditUsd) / revenuePerCredit
          : null;
      return {
        slug: p.slug,
        name: p.name,
        kind: p.kind,
        credits: p.credits,
        priceUsd,
        revenuePerCredit,
        grossMargin,
      };
    });

    return {
      hasData,
      totalCostUsd,
      costsSince,
      usageCalls: usageRows.length,
      costByProvider,
      totalFinishedMinutes,
      minutesByMode,
      costPerMinuteUsd,
      renderCreditsCharged,
      costPerCreditUsd,
      plans,
    };
  });

export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const [{ data: profiles, error }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("*").order("created_at", { ascending: false }),
      supabase.from("user_roles").select("user_id, role"),
    ]);
    if (error) throw new Error(error.message);

    const roleMap = new Map<string, string[]>();
    for (const row of roles ?? []) {
      roleMap.set(row.user_id, [...(roleMap.get(row.user_id) ?? []), row.role]);
    }

    return (profiles ?? []).map((p) => ({ ...p, roles: roleMap.get(p.id) ?? [] }));
  });

export const adminAdjustCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        delta: z.number().int().min(-10000).max(10000),
        reason: z.string().trim().min(1).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    // Atomic balance update + ledger insert in a single transaction via RPC.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: credits, error: adjustError } = await supabaseAdmin.rpc("adjust_credits", {
      p_user_id: data.userId,
      p_delta: data.delta,
      p_reason: data.reason,
      p_admin_id: userId,
    });
    if (adjustError) {
      if (adjustError.message.includes("PROFILE_NOT_FOUND")) {
        throw new Error("User not found");
      }
      throw new Error(adjustError.message);
    }

    return { credits: credits ?? 0 };
  });

export const adminSetUserStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ userId: z.string().uuid(), status: z.enum(["active", "suspended"]) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    // Account status is a protected column; write it via the service role.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ status: data.status })
      .eq("id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminSetUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ userId: z.string().uuid(), makeAdmin: z.boolean() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    if (data.userId === userId && !data.makeAdmin) {
      throw new Error("You can't remove your own admin access.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.makeAdmin) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: data.userId, role: "admin" }, { onConflict: "user_id,role" });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.userId)
        .eq("role", "admin");
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const adminListJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const [{ data: jobs, error }, { data: profiles }] = await Promise.all([
      supabase.from("video_jobs").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("profiles").select("id, email, display_name"),
    ]);
    if (error) throw new Error(error.message);

    const owners = new Map((profiles ?? []).map((p) => [p.id, p]));
    return (jobs ?? []).map((job) => ({
      ...job,
      owner: owners.get(job.user_id)?.email ?? owners.get(job.user_id)?.display_name ?? "unknown",
    }));
  });

export const adminDeleteJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { error } = await supabase.from("video_jobs").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminListContent = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data, error } = await supabase.from("site_content").select("*").order("key");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminSaveContent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ key: z.string().trim().min(1).max(60), value: z.record(z.string(), z.string()) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { error } = await supabase
      .from("site_content")
      .update({ value: data.value })
      .eq("key", data.key);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminListPlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data, error } = await supabase
      .from("pricing_plans")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminSavePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(60),
        price_monthly: z.number().min(0).max(100000),
        credits: z.number().int().min(0).max(1000000),
        blurb: z.string().trim().max(200),
        features: z.array(z.string().trim().max(160)).max(20),
        highlighted: z.boolean(),
        active: z.boolean(),
        sort_order: z.number().int().min(0).max(100),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { id, ...fields } = data;
    const { error } = await supabase.from("pricing_plans").update(fields).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminListIntegrations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data, error } = await supabase.from("integrations").select("*").order("category");
    if (error) throw new Error(error.message);

    // Never return secret values — only whether the secret is present.
    return (data ?? []).map((row) => ({
      ...row,
      secret_present: row.secret_name ? Boolean(process.env[row.secret_name]) : false,
    }));
  });

export const adminSaveIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        label: z.string().trim().min(1).max(80),
        description: z.string().trim().max(300),
        enabled: z.boolean(),
        settings: z.record(z.string(), z.string()).default({}),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { id, ...fields } = data;
    const { error } = await supabase
      .from("integrations")
      .update({
        ...fields,
        status: fields.enabled ? "connected" : "not_configured",
        last_checked_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminListMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data, error } = await supabase
      .from("contact_messages")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminSetMessageHandled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), handled: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { error } = await supabase
      .from("contact_messages")
      .update({ handled: data.handled })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* adminGrowthMetrics — Sprint 7-8                                     */
/* ------------------------------------------------------------------ */

import {
  computeActivation,
  computeCohortRetention,
  computeConversion,
  computeMrr,
  computeP95RenderTimePerMinute,
  computePublishing,
  computeRenderSuccess,
  computeSignups,
} from "./growth-metrics";

export interface ModeCost {
  mode: "story" | "cinema";
  costPerMinuteUsd: number | null;
  totalCostUsd: number;
  finishedMinutes: number;
}

export interface GrowthMetrics {
  signups: ReturnType<typeof computeSignups>;
  activation: ReturnType<typeof computeActivation>;
  retention: ReturnType<typeof computeCohortRetention>;
  conversion: ReturnType<typeof computeConversion>;
  mrr: ReturnType<typeof computeMrr>;
  renderQuality: ReturnType<typeof computeRenderSuccess>;
  p95: ReturnType<typeof computeP95RenderTimePerMinute>;
  costPerMode: ModeCost[];
  publishing: ReturnType<typeof computePublishing>;
}

/**
 * Business metrics for the admin dashboard, computed from REAL tables only:
 * profiles, renders, video_jobs, projects, subscriptions, plans,
 * publish_jobs, api_usage (via measuredCostPerMinute). Every sub-metric
 * carries hasData — the UI shows "No data yet" instead of fake zeros.
 */
export const adminGrowthMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GrowthMetrics> => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { measuredCostPerMinute } = await import("./billing/measured-cost");

    const [
      profilesRes,
      rendersRes,
      jobsRes,
      projectsRes,
      subsRes,
      plansRes,
      publishedRes,
      dubShortRes,
    ] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, created_at").limit(20000),
      supabaseAdmin
        .from("renders")
        .select("user_id, status, created_at, render_started_at, render_completed_at, duration, project_id, parent_id, meta")
        .limit(20000),
      supabaseAdmin.from("video_jobs").select("user_id, status, created_at").limit(20000),
      supabaseAdmin.from("projects").select("user_id, created_at").limit(20000),
      supabaseAdmin.from("subscriptions").select("user_id, plan_slug, status").limit(20000),
      supabaseAdmin.from("plans").select("slug, price_usd_cents, interval").eq("active", true),
      supabaseAdmin
        .from("publish_jobs")
        .select("id, project_id")
        .eq("status", "published")
        .limit(20000),
      // candidate dub/short renders (filtered in JS on meta.kind)
      supabaseAdmin
        .from("renders")
        .select("project_id, status, parent_id, meta")
        .in("status", ["completed"])
        .not("parent_id", "is", null)
        .limit(20000),
    ]);
    for (const r of [profilesRes, rendersRes, jobsRes, projectsRes, subsRes, plansRes, publishedRes, dubShortRes]) {
      if (r.error) throw new Error(r.error.message);
    }

    const profiles = (profilesRes.data ?? []).map((p) => ({
      id: p.id as string,
      created_at: p.created_at as string,
    }));

    const renders = (rendersRes.data ?? []) as {
      user_id: string; status: string; created_at: string;
      render_started_at: string | null; render_completed_at: string | null;
      duration: number | null; project_id: string | null;
      parent_id: string | null; meta: { kind?: string; language?: string } | null;
    }[];
    const jobs = (jobsRes.data ?? []) as { user_id: string; status: string; created_at: string }[];
    const projects = (projectsRes.data ?? []) as { user_id: string; created_at: string }[];

    // First completed render/job per user (activation).
    const firstCompletedAt = new Map<string, string>();
    const consider = (uid: string, at: string) => {
      const prev = firstCompletedAt.get(uid);
      if (!prev || at < prev) firstCompletedAt.set(uid, at);
    };
    for (const r of renders) {
      if (r.status === "completed") consider(r.user_id, r.created_at);
    }
    for (const j of jobs) {
      if (j.status === "completed") consider(j.user_id, j.created_at);
    }

    // Any activity timestamp per user (D7/D30 retention).
    const activityAt = new Map<string, string[]>();
    const addActivity = (uid: string, at: string) => {
      const list = activityAt.get(uid) ?? [];
      list.push(at);
      activityAt.set(uid, list);
    };
    for (const r of renders) addActivity(r.user_id, r.created_at);
    for (const j of jobs) addActivity(j.user_id, j.created_at);
    for (const p of projects) addActivity(p.user_id, p.created_at);

    const subs = (subsRes.data ?? []) as {
      user_id: string; plan_slug: string | null; status: string | null;
    }[];
    const paidUserIds = new Set(
      subs
        .filter((s) => s.status === "active" || s.status === "trialing")
        .map((s) => s.user_id),
    );
    const plans = (plansRes.data ?? []).map((p) => ({
      slug: p.slug as string,
      priceUsdCents: p.price_usd_cents as number | null,
      interval: (p.interval === "month" ? "month" : "once") as "month" | "once",
    }));

    const publishedJobs = (publishedRes.data ?? []).map((j) => ({
      id: j.id as string,
      project_id: j.project_id as string,
    }));

    const derived = (dubShortRes.data ?? []) as {
      project_id: string | null; status: string; parent_id: string | null;
      meta: { kind?: string; language?: string } | null;
    }[];
    const dubRenders = derived
      .filter((r) => r.meta?.kind === "dub")
      .map((r) => ({
        project_id: r.project_id ?? "",
        language: r.meta?.language ?? null,
        status: r.status,
      }));
    const shortRenders = derived
      .filter((r) => r.meta?.kind === "short")
      .map((r) => ({ status: r.status, parentId: r.parent_id, kind: "short" as const }));

    // Per-mode measured cost (30d window, api_usage + finished minutes).
    const [storyCost, cinemaCost] = await Promise.all([
      measuredCostPerMinute(supabaseAdmin, "story").catch(() => null),
      measuredCostPerMinute(supabaseAdmin, "cinema").catch(() => null),
    ]);

    return {
      signups: computeSignups(profiles),
      activation: computeActivation({ profiles, firstCompletedAt }),
      retention: computeCohortRetention({ profiles, activityAt }),
      conversion: computeConversion(profiles.length, paidUserIds),
      mrr: computeMrr(subs, plans),
      renderQuality: computeRenderSuccess(renders),
      p95: computeP95RenderTimePerMinute(renders),
      costPerMode: [
        {
          mode: "story" as const,
          costPerMinuteUsd: storyCost?.costPerMinuteUsd ?? null,
          totalCostUsd: storyCost?.totalCostUsd ?? 0,
          finishedMinutes: storyCost?.finishedMinutes ?? 0,
        },
        {
          mode: "cinema" as const,
          costPerMinuteUsd: cinemaCost?.costPerMinuteUsd ?? null,
          totalCostUsd: cinemaCost?.totalCostUsd ?? 0,
          finishedMinutes: cinemaCost?.finishedMinutes ?? 0,
        },
      ],
      publishing: computePublishing(publishedJobs, dubRenders, shortRenders),
    };
  });

/* ------------------------------------------------------------------ */
/* adminNpsResults — Sprint 7-8                                        */
/* ------------------------------------------------------------------ */

import { computeNps, recentComments } from "./nps";

export interface NpsAdminResult {
  summary: ReturnType<typeof computeNps>;
  comments: ReturnType<typeof recentComments>;
}

/** NPS summary + recent verbatims for the admin dashboard. */
export const adminNpsResults = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<NpsAdminResult> => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("nps_responses")
      .select("score, comment, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    const responses = (data ?? []).map((r) => ({
      score: Number(r.score),
      comment: r.comment as string | null,
      createdAt: r.created_at as string,
    }));
    return {
      summary: computeNps(responses),
      comments: recentComments(responses, 20),
    };
  });

/** A single safety rule row for the admin panel. */
export interface AdminSafetyRule {
  ruleKey: string;
  description: string;
  /** Numeric rule params only (the loader filters non-numeric values). */
  params: Record<string, number>;
  version: number;
  active: boolean;
  lastReviewedAt: string;
  reviewOverdue: boolean;
}

/** Review cadence for safety rules: founders review them quarterly. */
export const SAFETY_RULE_REVIEW_DAYS = 90;

/**
 * Sprint 7-8 C: safety rules with their last_reviewed_at dates for the admin
 * panel. Rules with no review in SAFETY_RULE_REVIEW_DAYS are flagged overdue
 * so the quarterly review (FOUNDER_TODO) doesn't silently slip.
 */
export const adminSafetyRules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await supabaseAdmin
      .from("safety_rules")
      .select("rule_key, description, params, version, active, last_reviewed_at")
      .order("version", { ascending: false })
      .order("rule_key");
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as {
      rule_key: string;
      description: string;
      params: Record<string, unknown> | null;
      version: number;
      active: boolean;
      last_reviewed_at: string;
    }[];
    const activeVersion = rows.find((r) => r.active)?.version ?? null;
    const cutoff = Date.now() - SAFETY_RULE_REVIEW_DAYS * 24 * 3600 * 1000;
    const rules: AdminSafetyRule[] = rows.map((r) => {
      // Keep only numeric params (serializable; matches the scorer's loader).
      const params: Record<string, number> = {};
      for (const [k, v] of Object.entries(r.params ?? {})) {
        if (typeof v === "number" && Number.isFinite(v)) params[k] = v;
      }
      return {
        ruleKey: r.rule_key,
        description: r.description,
        params,
        version: r.version,
        active: r.active,
        lastReviewedAt: r.last_reviewed_at,
        reviewOverdue: new Date(r.last_reviewed_at).getTime() < cutoff,
      };
    });
    return {
      activeVersion,
      rules,
      overdueCount: rules.filter((r) => r.reviewOverdue && r.active).length,
    };
  });
