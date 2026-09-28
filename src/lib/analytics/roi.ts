/**
 * Phase 4 · Stream B — F38 ROI Studio.
 *
 * Cost-per-video vs outcome:
 *  - COSTS are real: net credits from `credit_ledger` (debits negative,
 *    refunds positive), attributed to a video through
 *    ref_id → renders.id | renders.job_id (video_jobs) | projects.id,
 *    then renders.project_id → publish_jobs → youtube_video_id.
 *  - REVENUE is always ESTIMATE-labeled (views × user RPM from
 *    monetization_settings), never presented as measured earnings.
 *  - Per-plan cost transparency: every cost is shown in USD at each plan's
 *    effective per-credit rate (src/lib/billing/plans.ts).
 *  - Ledger rows that cannot be attributed are reported honestly as
 *    "unattributed production cost", not silently dropped.
 */

import { PLANS } from "../billing/plans";
import { estimateRevenueUsd } from "./monetization";

export interface LedgerEntry {
  delta: number;
  ref_id: string | null;
  reason: string;
  created_at: string;
}

export interface RenderRef {
  id: string;
  project_id: string | null;
  job_id: string | null;
}

export interface Attribution {
  /** project_id → net credits spent (positive = cost). */
  byProject: Map<string, { credits: number; entries: number }>;
  unattributedCredits: number;
  unattributedEntries: number;
  totalCredits: number;
}

/**
 * Attribute ledger debits/refunds to projects. Pure.
 *
 * Resolution order for ref_id: renders.id → renders.job_id (video job) →
 * projects.id (legacy one-credit debits). A job ref spanning several render
 * rows (one per aspect) splits its cost evenly across the distinct projects.
 */
export function attributeCosts(
  entries: LedgerEntry[],
  renders: RenderRef[],
  projectIds: Set<string>,
): Attribution {
  const renderById = new Map(renders.map((r) => [r.id, r]));
  const rendersByJob = new Map<string, RenderRef[]>();
  for (const r of renders) {
    if (!r.job_id) continue;
    const arr = rendersByJob.get(r.job_id) ?? [];
    arr.push(r);
    rendersByJob.set(r.job_id, arr);
  }

  const byProject = new Map<string, { credits: number; entries: number }>();
  let unattributedCredits = 0;
  let unattributedEntries = 0;

  const add = (projectId: string, credits: number) => {
    const cur = byProject.get(projectId) ?? { credits: 0, entries: 0 };
    cur.credits += credits;
    cur.entries += 1;
    byProject.set(projectId, cur);
  };

  for (const e of entries) {
    const credits = -e.delta; // debits are negative deltas; refunds reduce cost
    const ref = e.ref_id;
    if (!ref) {
      unattributedCredits += credits;
      unattributedEntries += 1;
      continue;
    }
    const render = renderById.get(ref);
    if (render?.project_id) {
      add(render.project_id, credits);
      continue;
    }
    const jobRenders = rendersByJob.get(ref) ?? [];
    const projects = [...new Set(jobRenders.map((r) => r.project_id).filter((p): p is string => !!p))];
    if (projects.length > 0) {
      const share = credits / projects.length;
      for (const p of projects) add(p, share);
      continue;
    }
    if (projectIds.has(ref)) {
      add(ref, credits);
      continue;
    }
    unattributedCredits += credits;
    unattributedEntries += 1;
  }

  const totalCredits = [...byProject.values()].reduce((a, v) => a + v.credits, 0) + unattributedCredits;
  return { byProject, unattributedCredits, unattributedEntries, totalCredits };
}

/** USD value of N credits at each plan's effective per-credit rate. Pure. */
export function usdAtPlanRates(credits: number): { planSlug: string; planName: string; usd: number }[] {
  return PLANS.filter((p) => p.priceUsdCents != null && p.credits > 0).map((p) => ({
    planSlug: p.slug,
    planName: p.name,
    usd: (credits * (p.priceUsdCents as number)) / 100 / p.credits,
  }));
}

export interface RoiVideoRow {
  youtubeVideoId: string | null;
  title: string;
  credits: number;
  usdAtPlanRates: { planSlug: string; planName: string; usd: number }[];
  views: number;
  watchTimeMinutes: number;
  /** Null when no RPM is set — never shown as $0. */
  revenueEstimateUsd: number | null;
  /** revenueEstimate / cost(usd at Studio rate); null when not computable. ESTIMATE-based. */
  roiMultipleEstimate: number | null;
}

export interface RoiReport {
  videos: RoiVideoRow[];
  totals: {
    credits: number;
    usdAtPlanRates: { planSlug: string; planName: string; usd: number }[];
    views: number;
    watchTimeMinutes: number;
    revenueEstimateUsd: number | null;
  };
  unattributed: { credits: number; entries: number };
  rpmEstimateUsd: number | null;
  hasData: boolean;
}

interface VideoOutcome {
  projectId: string;
  youtubeVideoId: string | null;
  title: string;
  views: number;
  watchTimeMinutes: number;
}

/** Assemble the ROI report. Pure. */
export function buildRoiReport(
  attribution: Attribution,
  outcomes: VideoOutcome[],
  rpmEstimateUsd: number | null,
): RoiReport {
  const studioRate = PLANS.find((p) => p.slug === "studio");
  const studioUsdPerCredit =
    studioRate && studioRate.priceUsdCents != null ? studioRate.priceUsdCents / 100 / studioRate.credits : null;

  const videos: RoiVideoRow[] = outcomes.map((o) => {
    const cost = attribution.byProject.get(o.projectId);
    const credits = cost?.credits ?? 0;
    const revenueEstimateUsd = rpmEstimateUsd != null ? estimateRevenueUsd(o.views, rpmEstimateUsd) : null;
    const costUsdStudio = studioUsdPerCredit != null ? credits * studioUsdPerCredit : null;
    const roiMultipleEstimate =
      revenueEstimateUsd != null && costUsdStudio != null && costUsdStudio > 0
        ? revenueEstimateUsd / costUsdStudio
        : null;
    return {
      youtubeVideoId: o.youtubeVideoId,
      title: o.title,
      credits,
      usdAtPlanRates: usdAtPlanRates(credits),
      views: o.views,
      watchTimeMinutes: o.watchTimeMinutes,
      revenueEstimateUsd,
      roiMultipleEstimate,
    };
  });

  const totals = {
    credits: attribution.totalCredits,
    usdAtPlanRates: usdAtPlanRates(attribution.totalCredits),
    views: videos.reduce((a, v) => a + v.views, 0),
    watchTimeMinutes: videos.reduce((a, v) => a + v.watchTimeMinutes, 0),
    revenueEstimateUsd:
      rpmEstimateUsd != null
        ? videos.reduce((a, v) => a + (v.revenueEstimateUsd ?? 0), 0)
        : null,
  };
  return {
    videos: videos.sort((a, b) => b.credits - a.credits),
    totals,
    unattributed: { credits: attribution.unattributedCredits, entries: attribution.unattributedEntries },
    rpmEstimateUsd,
    hasData: outcomes.length > 0 || attribution.totalCredits !== 0,
  };
}

/** Server loader: ledger + renders + outcomes → ROI report. */
export async function loadRoiReport(admin: any, userId: string): Promise<RoiReport> {
  const [{ data: ledger }, { data: renderRows }, { data: projectRows }, { data: settingsRow }] =
    await Promise.all([
      admin.from("credit_ledger").select("delta, ref_id, reason, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(5000),
      admin.from("renders").select("id, project_id, job_id").eq("user_id", userId),
      admin.from("projects").select("id, title").eq("user_id", userId),
      admin.from("monetization_settings").select("rpm_estimate_usd").eq("user_id", userId).maybeSingle(),
    ]);

  const renders: RenderRef[] = (renderRows ?? []) as RenderRef[];
  const projectIds = new Set<string>((projectRows ?? []).map((p: any) => p.id as string));
  const titleByProject = new Map<string, string>((projectRows ?? []).map((p: any) => [p.id, p.title ?? "Untitled"]));
  const attribution = attributeCosts((ledger ?? []) as LedgerEntry[], renders, projectIds);

  // Outcomes: project → publish job → video metrics.
  const { data: jobs } = await admin
    .from("publish_jobs")
    .select("project_id, youtube_video_id, title")
    .eq("user_id", userId)
    .eq("status", "published");
  const videoByProject = new Map<string, { youtubeVideoId: string | null; title: string }>();
  for (const j of (jobs ?? []) as any[]) {
    if (!videoByProject.has(j.project_id)) {
      videoByProject.set(j.project_id, { youtubeVideoId: j.youtube_video_id ?? null, title: j.title ?? titleByProject.get(j.project_id) ?? "Untitled" });
    }
  }
  const youtubeIds = [...videoByProject.values()].map((v) => v.youtubeVideoId).filter((id): id is string => !!id);
  const metricsByVideo = new Map<string, { views: number; watchTimeMinutes: number }>();
  if (youtubeIds.length > 0) {
    const { data: vids } = await admin
      .from("video_analytics")
      .select("youtube_video_id, metrics")
      .eq("user_id", userId)
      .in("youtube_video_id", youtubeIds)
      .order("snapshot_date", { ascending: false });
    for (const v of (vids ?? []) as any[]) {
      if (!metricsByVideo.has(v.youtube_video_id)) {
        metricsByVideo.set(v.youtube_video_id, {
          views: Number(v.metrics?.views ?? 0),
          watchTimeMinutes: Number(v.metrics?.watchTimeMinutes ?? 0),
        });
      }
    }
  }

  const outcomes: VideoOutcome[] = [];
  const seenProjects = new Set<string>();
  for (const [projectId, cost] of attribution.byProject) {
    if (cost.credits === 0) continue;
    seenProjects.add(projectId);
    const v = videoByProject.get(projectId);
    const m = v?.youtubeVideoId ? metricsByVideo.get(v.youtubeVideoId) : undefined;
    outcomes.push({
      projectId,
      youtubeVideoId: v?.youtubeVideoId ?? null,
      title: v?.title ?? titleByProject.get(projectId) ?? "Untitled project",
      views: m?.views ?? 0,
      watchTimeMinutes: m?.watchTimeMinutes ?? 0,
    });
  }
  // Projects with published videos but no ledger cost (e.g. free renders) still show.
  for (const [projectId, v] of videoByProject) {
    if (seenProjects.has(projectId)) continue;
    const m = v.youtubeVideoId ? metricsByVideo.get(v.youtubeVideoId) : undefined;
    outcomes.push({
      projectId,
      youtubeVideoId: v.youtubeVideoId,
      title: v.title,
      views: m?.views ?? 0,
      watchTimeMinutes: m?.watchTimeMinutes ?? 0,
    });
  }

  const rpm = settingsRow?.rpm_estimate_usd != null ? Number(settingsRow.rpm_estimate_usd) : null;
  return buildRoiReport(attribution, outcomes, rpm);
}
