/**
 * Phase 4 · Stream B — F32 Scene-aware retention (pure analysis + loader).
 *
 * D139: the weakest scene is diagnosed from REAL points only
 * (`retention_snapshots.points: [{t, r, scene_id?}]`):
 *   - baseline = mean retention of the first 3 points (the hook)
 *   - weakest point = the point with the largest drop below that baseline
 *   - weakest scene = the scene owning that point (via scene_id)
 * Points are NEVER invented or interpolated — gaps stay gaps. Fewer than
 * MIN_POINTS points → `insufficient_data`, rendered as an honest empty state.
 */

export interface RetentionPoint {
  /** Seconds into the video. */
  t: number;
  /** Absolute audience retention, 0–100. */
  r: number;
  scene_id?: string | null;
}

export interface SceneInfo {
  id: string;
  scene_number: number;
}

export interface WeakestScene {
  scene_id: string;
  scene_number: number | null;
  /** Seconds into the video where the biggest drop happens. */
  atSeconds: number;
  /** Baseline (hook) retention minus retention at the weakest point, in points. */
  dropPoints: number;
  hookBaseline: number;
  weakestRetention: number;
  /** Descriptive diagnosis — never a guaranteed fix. */
  diagnosis: string;
}

export interface RetentionDiagnosis {
  status: "ok" | "insufficient_data";
  pointCount: number;
  hookBaseline: number | null;
  weakestScene: WeakestScene | null;
  /** Points that could not be attributed to any scene (no scene_id). */
  unattributedPoints: number;
  perSceneAvg: { scene_id: string; scene_number: number | null; avgRetention: number; points: number }[];
}

export const MIN_RETENTION_POINTS = 4;

function parsePoints(raw: unknown): RetentionPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: RetentionPoint[] = [];
  for (const p of raw) {
    if (typeof p !== "object" || p === null) continue;
    const t = Number((p as any).t);
    const r = Number((p as any).r);
    if (!Number.isFinite(t) || !Number.isFinite(r)) continue;
    out.push({ t, r, scene_id: (p as any).scene_id ?? null });
  }
  return out.sort((a, b) => a.t - b.t);
}

function diagnosisFor(positionRatio: number, sceneNumber: number | null): string {
  const where = sceneNumber != null ? `scene ${sceneNumber}` : "this section";
  if (positionRatio < 0.25) {
    return `Viewers drop at ${where} — early in the video. The hook isn't holding past the opening; the payoff or curiosity gap may need to land sooner.`;
  }
  if (positionRatio < 0.7) {
    return `Viewers drop at ${where} — mid-video. The middle sags before the payoff; consider tightening or re-hooking here.`;
  }
  return `Viewers drop at ${where} — late in the video. Viewers leave before the payoff lands, or the outro drags; the payoff may be too late.`;
}

/**
 * Diagnose the weakest scene from retention points. Pure — no invented data.
 */
export function diagnoseRetention(
  rawPoints: unknown,
  scenes: SceneInfo[],
): RetentionDiagnosis {
  const points = parsePoints(rawPoints);
  if (points.length < MIN_RETENTION_POINTS) {
    return {
      status: "insufficient_data",
      pointCount: points.length,
      hookBaseline: null,
      weakestScene: null,
      unattributedPoints: 0,
      perSceneAvg: [],
    };
  }

  const hookBaseline = points.slice(0, 3).reduce((a, p) => a + p.r, 0) / 3;
  const sceneById = new Map(scenes.map((s) => [s.id, s]));

  let weakest: RetentionPoint | null = null;
  let maxDrop = -Infinity;
  let unattributed = 0;
  const perScene = new Map<string, { sum: number; n: number }>();
  for (const p of points) {
    if (p.scene_id == null) {
      unattributed++;
      continue;
    }
    const drop = hookBaseline - p.r;
    if (drop > maxDrop) {
      maxDrop = drop;
      weakest = p;
    }
    const agg = perScene.get(p.scene_id) ?? { sum: 0, n: 0 };
    agg.sum += p.r;
    agg.n += 1;
    perScene.set(p.scene_id, agg);
  }

  const perSceneAvg = [...perScene.entries()].map(([scene_id, agg]) => ({
    scene_id,
    scene_number: sceneById.get(scene_id)?.scene_number ?? null,
    avgRetention: agg.sum / agg.n,
    points: agg.n,
  }));

  if (!weakest || maxDrop <= 0) {
    // Retention never dips below the hook baseline — nothing to diagnose.
    return {
      status: "ok",
      pointCount: points.length,
      hookBaseline,
      weakestScene: null,
      unattributedPoints: unattributed,
      perSceneAvg,
    };
  }

  const scene = sceneById.get(weakest.scene_id!);
  const videoLength = Math.max(...points.map((p) => p.t), 1);
  const diagnosis: WeakestScene = {
    scene_id: weakest.scene_id!,
    scene_number: scene?.scene_number ?? null,
    atSeconds: weakest.t,
    dropPoints: maxDrop,
    hookBaseline,
    weakestRetention: weakest.r,
    diagnosis: diagnosisFor(weakest.t / videoLength, scene?.scene_number ?? null),
  };
  return {
    status: "ok",
    pointCount: points.length,
    hookBaseline,
    weakestScene: diagnosis,
    unattributedPoints: unattributed,
    perSceneAvg,
  };
}

export interface VideoRetention {
  youtubeVideoId: string | null;
  title: string;
  diagnosis: RetentionDiagnosis;
  capturedAt: string;
  source: string;
}

/** Server loader: latest retention snapshot per video with scene mapping. */
export async function loadRetentionDiagnoses(admin: any, userId: string): Promise<VideoRetention[]> {
  const { data: snaps, error } = await admin
    .from("retention_snapshots")
    .select("youtube_video_id, publish_job_id, points, weakest_scene, captured_at, source")
    .eq("user_id", userId)
    .order("captured_at", { ascending: false });
  if (error) throw new Error(error.message);
  const latest = new Map<string, any>();
  for (const s of (snaps ?? []) as any[]) {
    const key = s.youtube_video_id ?? s.publish_job_id ?? s.id;
    if (!latest.has(key)) latest.set(key, s);
  }
  if (latest.size === 0) return [];

  // Resolve project → scenes for scene numbers.
  const jobIds = [...latest.values()].map((s: any) => s.publish_job_id).filter(Boolean);
  let projectByJob = new Map<string, string>();
  if (jobIds.length > 0) {
    const { data: jobs } = await admin
      .from("publish_jobs")
      .select("id, project_id, title, youtube_video_id")
      .in("id", jobIds);
    for (const j of (jobs ?? []) as any[]) projectByJob.set(j.id, j.project_id);
  }
  const titleByKey = new Map<string, string>();
  if (jobIds.length > 0) {
    const { data: jobs } = await admin
      .from("publish_jobs")
      .select("id, title, youtube_video_id")
      .in("id", jobIds);
    for (const j of (jobs ?? []) as any[]) {
      titleByKey.set(j.id, j.title ?? "Untitled");
      if (j.youtube_video_id) titleByKey.set(j.youtube_video_id, j.title ?? "Untitled");
    }
  }
  const projectIds = [...new Set(projectByJob.values())];
  let scenesByProject = new Map<string, SceneInfo[]>();
  if (projectIds.length > 0) {
    const { data: scenes } = await admin
      .from("scenes")
      .select("id, project_id, scene_number")
      .in("project_id", projectIds)
      .order("scene_number", { ascending: true });
    for (const s of (scenes ?? []) as any[]) {
      const arr = scenesByProject.get(s.project_id) ?? [];
      arr.push({ id: s.id, scene_number: s.scene_number });
      scenesByProject.set(s.project_id, arr);
    }
  }

  const out: VideoRetention[] = [];
  for (const [key, s] of latest) {
    const projectId = s.publish_job_id ? projectByJob.get(s.publish_job_id) : undefined;
    const scenes = projectId ? (scenesByProject.get(projectId) ?? []) : [];
    out.push({
      youtubeVideoId: s.youtube_video_id ?? null,
      title: titleByKey.get(key) ?? "Untitled",
      diagnosis: diagnoseRetention(s.points, scenes),
      capturedAt: s.captured_at,
      source: s.source ?? "fixture",
    });
  }
  return out;
}
