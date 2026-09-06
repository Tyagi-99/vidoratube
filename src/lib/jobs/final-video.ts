/**
 * Pure helpers for quick-generate final-video readiness and download selection.
 * Keeps "preview assets ready" distinct from a validated muxed MP4.
 */

export type FinalVideoJobLike = {
  status: string;
  stage: string;
  result_url: string | null;
  audio_url?: string | null;
  assets?: unknown;
};

/** Stages where stills+VO exist but the final MP4 is not stored yet. */
export const CLIENT_COMPOSE_STAGES = ["client_render", "preview"] as const;

export function hasVisualAssets(assets: unknown): boolean {
  return Array.isArray(assets) && assets.some((u) => typeof u === "string" && u.length > 0);
}

/** True when the job should be composed in-browser (no Shotstack / no result yet). */
export function needsClientCompose(job: FinalVideoJobLike): boolean {
  if (job.result_url) return false;
  if (!job.audio_url) return false;
  if (!hasVisualAssets(job.assets)) return false;
  return (CLIENT_COMPOSE_STAGES as readonly string[]).includes(job.stage);
}

/** Preview-as-done is never a final video — only a validated result_url counts. */
export function isFinalVideoReady(job: Pick<FinalVideoJobLike, "status" | "result_url">): boolean {
  return job.status === "completed" && Boolean(job.result_url);
}

/**
 * Download must be the muxed MP4 only. Never fall back to narration audio.
 */
export function selectDownloadUrl(job: Pick<FinalVideoJobLike, "result_url">): string | null {
  return job.result_url ?? null;
}

/** Stage after visuals when Shotstack is unavailable — wait for client compose. */
export function nextStageAfterVisuals(shotstackConfigured: boolean): {
  stage: string;
  progress: number;
  step: string;
} {
  if (shotstackConfigured) {
    return { stage: "render", progress: 70, step: "Composing the cut" };
  }
  return { stage: "client_render", progress: 72, step: "Composing the cut" };
}

/** Lightweight MP4 sniff (ftyp box) — used when ffprobe is unavailable. */
export function looksLikeMp4(bytes: ArrayBuffer | Uint8Array): boolean {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length < 12) return false;
  // ISO BMFF: size(4) + 'ftyp'(4) at offset 4
  return u8[4] === 0x66 && u8[5] === 0x74 && u8[6] === 0x79 && u8[7] === 0x70;
}

export function validateClientFinalizeMeta(input: {
  file_size: number;
  duration: number;
}): string | null {
  if (!Number.isFinite(input.file_size) || input.file_size < 1024) {
    return "Rendered file is too small to be a valid MP4.";
  }
  if (!Number.isFinite(input.duration) || input.duration <= 0) {
    return "Rendered file has no playable duration.";
  }
  return null;
}
