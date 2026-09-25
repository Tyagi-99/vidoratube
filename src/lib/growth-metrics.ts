/**
 * Sprint 7-8: admin growth / business metrics — pure computations.
 *
 * Every function here takes plain row shapes (the server function does the
 * DB reads) and returns nulls / hasData:false when there is not enough real
 * data — never zeros dressed up as measurements. The UI renders an honest
 * empty state from hasData.
 */

export interface ProfileRow {
  id: string;
  created_at: string;
}

/** Activity = first completed render OR video_job per user (ISO timestamp). */
export interface ActivationInput {
  profiles: ProfileRow[];
  /** user_id -> ISO timestamp of first completed render/job. */
  firstCompletedAt: Map<string, string>;
}

export interface ActivationResult {
  hasData: boolean;
  totalUsers: number;
  activated: number;
  /** activated / totalUsers, null without data. */
  rate: number | null;
}

/**
 * Activation: share of users whose first completed render/job landed within
 * 24h of signup. Only users old enough to have had a full 24h window count
 * toward the denominator (avoids punishing today's signups).
 */
export function computeActivation(
  input: ActivationInput,
  now: Date = new Date(),
): ActivationResult {
  const WINDOW_MS = 24 * 3600_000;
  let totalUsers = 0;
  let activated = 0;
  for (const p of input.profiles) {
    const signedUp = Date.parse(p.created_at);
    if (!Number.isFinite(signedUp)) continue;
    if (now.getTime() - signedUp < WINDOW_MS) continue; // window not over yet
    totalUsers++;
    const first = input.firstCompletedAt.get(p.id);
    if (first && Date.parse(first) - signedUp <= WINDOW_MS) activated++;
  }
  return {
    hasData: totalUsers > 0,
    totalUsers,
    activated,
    rate: totalUsers > 0 ? activated / totalUsers : null,
  };
}

/* ------------------------------ retention ------------------------------ */

export interface RetentionInput {
  profiles: ProfileRow[];
  /** user_id -> all activity ISO timestamps (renders, jobs, ideas...). */
  activityAt: Map<string, string[]>;
}

export interface CohortSlice {
  eligible: number;
  active: number;
  rate: number | null;
}

export interface RetentionResult {
  hasData: boolean;
  d7: CohortSlice;
  d30: CohortSlice;
}

function cohortSlice(
  profiles: ProfileRow[],
  activityAt: Map<string, string[]>,
  day: number,
  nowMs: number,
): CohortSlice {
  const DAY_MS = 86_400_000;
  let eligible = 0;
  let active = 0;
  for (const p of profiles) {
    const signedUp = Date.parse(p.created_at);
    if (!Number.isFinite(signedUp)) continue;
    if (nowMs - signedUp < (day + 1) * DAY_MS) continue; // cohort too young
    eligible++;
    const winStart = signedUp + day * DAY_MS;
    const winEnd = winStart + DAY_MS;
    const hit = (activityAt.get(p.id) ?? []).some((iso) => {
      const t = Date.parse(iso);
      return Number.isFinite(t) && t >= winStart && t < winEnd;
    });
    if (hit) active++;
  }
  return { eligible, active, rate: eligible > 0 ? active / eligible : null };
}

/**
 * D7 / D30 retention: of the users whose signup is old enough, the share
 * with at least one activity timestamp inside the [day, day+1) window after
 * signup. Documented as a day-window definition (not "still subscribed").
 */
export function computeCohortRetention(
  input: RetentionInput,
  now: Date = new Date(),
): RetentionResult {
  const nowMs = now.getTime();
  const d7 = cohortSlice(input.profiles, input.activityAt, 7, nowMs);
  const d30 = cohortSlice(input.profiles, input.activityAt, 30, nowMs);
  return {
    hasData: d7.eligible > 0 || d30.eligible > 0,
    d7,
    d30,
  };
}

/* ------------------------------ signups -------------------------------- */

export interface SignupResult {
  hasData: boolean;
  total: number;
  /** YYYY-MM -> count, ascending. */
  byMonth: { month: string; count: number }[];
}

export function computeSignups(profiles: ProfileRow[]): SignupResult {
  const byMonth = new Map<string, number>();
  let total = 0;
  for (const p of profiles) {
    const t = Date.parse(p.created_at);
    if (!Number.isFinite(t)) continue;
    total++;
    const d = new Date(t);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    byMonth.set(key, (byMonth.get(key) ?? 0) + 1);
  }
  return {
    hasData: total > 0,
    total,
    byMonth: [...byMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, count]) => ({ month, count })),
  };
}

/* ----------------------------- conversion ------------------------------ */

export interface ConversionResult {
  hasData: boolean;
  totalUsers: number;
  paidUsers: number;
  /** paidUsers / totalUsers, null without data. */
  rate: number | null;
}

/** Free-to-paid: share of all users holding an active paid subscription. */
export function computeConversion(
  totalUsers: number,
  paidUserIds: Set<string> | string[],
): ConversionResult {
  const paid = new Set(paidUserIds).size;
  return {
    hasData: totalUsers > 0,
    totalUsers,
    paidUsers: paid,
    rate: totalUsers > 0 ? paid / totalUsers : null,
  };
}

/* --------------------------------- MRR --------------------------------- */

export interface SubscriptionRow {
  user_id: string;
  plan_slug: string | null;
  status: string | null;
}

export interface PlanPrice {
  slug: string;
  /** Monthly price in USD cents; null = unknown. */
  priceUsdCents: number | null;
  interval: "month" | "once";
}

export interface MrrResult {
  hasData: boolean;
  /** Monthly recurring revenue in USD (subscriptions only, no packs). */
  mrrUsd: number;
  activeSubscriptions: number;
  byPlan: { slug: string; count: number; mrrUsd: number }[];
}

/** MRR from active subscriptions only (status active/trialing, interval month). */
export function computeMrr(
  subscriptions: SubscriptionRow[],
  plans: PlanPrice[],
): MrrResult {
  const ACTIVE = new Set(["active", "trialing"]);
  const priceBySlug = new Map(plans.map((p) => [p.slug, p]));
  const byPlan = new Map<string, { count: number; mrrUsd: number }>();
  let activeSubscriptions = 0;
  for (const s of subscriptions) {
    if (!s.plan_slug || !ACTIVE.has(s.status ?? "")) continue;
    const plan = priceBySlug.get(s.plan_slug);
    if (!plan || plan.interval !== "month" || plan.priceUsdCents == null) continue;
    activeSubscriptions++;
    const row = byPlan.get(s.plan_slug) ?? { count: 0, mrrUsd: 0 };
    row.count++;
    row.mrrUsd += plan.priceUsdCents / 100;
    byPlan.set(s.plan_slug, row);
  }
  const mrrUsd = [...byPlan.values()].reduce((a, r) => a + r.mrrUsd, 0);
  return {
    hasData: activeSubscriptions > 0,
    mrrUsd: Math.round(mrrUsd * 100) / 100,
    activeSubscriptions,
    byPlan: [...byPlan.entries()]
      .map(([slug, r]) => ({ slug, ...r, mrrUsd: Math.round(r.mrrUsd * 100) / 100 }))
      .sort((a, b) => b.mrrUsd - a.mrrUsd),
  };
}

/* ---------------------------- render quality ---------------------------- */

export interface RenderQualityRow {
  status: string;
}

export interface RenderQualityResult {
  hasData: boolean;
  total: number;
  completed: number;
  failed: number;
  /** completed / (completed + failed); in-flight rows don't count either way. */
  successRate: number | null;
}

export const RENDER_SUCCESS_TARGET = 0.98;

/**
 * Render success rate. The denominator is terminal outcomes only
 * (completed + failed) — queued/running/cancelled renders are neither
 * successes nor failures.
 */
export function computeRenderSuccess(rows: RenderQualityRow[]): RenderQualityResult {
  let completed = 0;
  let failed = 0;
  for (const r of rows) {
    if (r.status === "completed") completed++;
    else if (r.status === "failed") failed++;
  }
  const total = completed + failed;
  return {
    hasData: total > 0,
    total,
    completed,
    failed,
    successRate: total > 0 ? completed / total : null,
  };
}

/* ------------------------- p95 render time / minute ----------------------- */

export interface RenderTimingRow {
  render_started_at: string | null;
  render_completed_at: string | null;
  /** Output duration in seconds. */
  duration: number | null;
}

export interface P95Result {
  hasData: boolean;
  /** p95 wall-clock minutes per output minute, null without data. */
  p95MinutesPerOutputMinute: number | null;
  samples: number;
}

/**
 * p95 of (wall-clock render time) / (finished output minute), over renders
 * that have both timestamps and a positive output duration. "Per output
 * minute" normalizes away video length so a 20-min chapter render and a
 * 30-second short are comparable.
 */
export function computeP95RenderTimePerMinute(rows: RenderTimingRow[]): P95Result {
  const ratios: number[] = [];
  for (const r of rows) {
    const start = r.render_started_at ? Date.parse(r.render_started_at) : NaN;
    const end = r.render_completed_at ? Date.parse(r.render_completed_at) : NaN;
    const durSec = Number(r.duration);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    if (!Number.isFinite(durSec) || durSec <= 0) continue;
    const wallMin = (end - start) / 60000;
    const outMin = durSec / 60;
    ratios.push(wallMin / outMin);
  }
  if (ratios.length === 0) {
    return { hasData: false, p95MinutesPerOutputMinute: null, samples: 0 };
  }
  ratios.sort((a, b) => a - b);
  const idx = Math.min(ratios.length - 1, Math.ceil(0.95 * ratios.length) - 1);
  return {
    hasData: true,
    p95MinutesPerOutputMinute: Math.round(ratios[idx]! * 100) / 100,
    samples: ratios.length,
  };
}

/* ------------------------------- publishing ----------------------------- */

export interface PublishedJobRow {
  id: string;
  project_id: string;
}

export interface DubRenderRow {
  project_id: string;
  language: string | null;
  status: string;
}

export interface ShortRenderRow {
  status: string;
  /** The source render id (parent_id). Null for non-shorts. */
  parentId: string | null;
  /** renders.meta.kind: 'short' | 'dub' | ... */
  kind: string | null;
}

export interface PublishingResult {
  hasData: boolean;
  videosPublished: number;
  /** Share of published videos with ≥1 completed dub, null without data. */
  localizedPct: number | null;
  localizedCount: number;
  /** Mean distinct dub languages per localized published video. */
  avgLanguagesPerPublishedVideo: number | null;
  /** Completed shorts per completed long (parent) render, null without data. */
  shortsPerLongVideo: number | null;
  shortsGenerated: number;
}

/**
 * Publishing funnel from real tables:
 * - videosPublished: publish_jobs with status='published' (caller filters).
 * - localized: a published video counts as localized when its project has
 *   at least one completed dub render.
 * - avgLanguages: distinct dub languages per localized video, averaged.
 * - shortsPerLongVideo: completed shorts ÷ distinct parent renders of
 *   those shorts.
 */
export function computePublishing(
  publishedJobs: PublishedJobRow[],
  dubRenders: DubRenderRow[],
  shortRenders: ShortRenderRow[],
): PublishingResult {
  const videosPublished = publishedJobs.length;

  const dubsByProject = new Map<string, Set<string>>();
  for (const d of dubRenders) {
    if (d.status !== "completed") continue;
    const set = dubsByProject.get(d.project_id) ?? new Set<string>();
    if (d.language) set.add(d.language);
    dubsByProject.set(d.project_id, set);
  }
  let localizedCount = 0;
  let languageTotal = 0;
  for (const j of publishedJobs) {
    const langs = dubsByProject.get(j.project_id);
    if (langs && langs.size > 0) {
      localizedCount++;
      languageTotal += langs.size;
    }
  }

  const completedShorts = shortRenders.filter(
    (r) => r.status === "completed" && r.kind === "short" && r.parentId,
  );
  const parents = new Set(completedShorts.map((r) => r.parentId as string));

  return {
    hasData: videosPublished > 0,
    videosPublished,
    localizedPct: videosPublished > 0 ? localizedCount / videosPublished : null,
    localizedCount,
    avgLanguagesPerPublishedVideo:
      localizedCount > 0 ? Math.round((languageTotal / localizedCount) * 100) / 100 : null,
    shortsPerLongVideo:
      parents.size > 0
        ? Math.round((completedShorts.length / parents.size) * 100) / 100
        : null,
    shortsGenerated: completedShorts.length,
  };
}
