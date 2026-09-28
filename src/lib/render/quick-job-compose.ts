/**
 * Client-side compose for quick-generate video_jobs when Shotstack is absent.
 * Reuses browser-render (ffmpeg.wasm) — does not alter the studio RenderPanel path.
 */

import type { RenderProgress, RenderResult, RenderScene } from "./browser-render";

export type QuickJobComposeInput = {
  title: string;
  images: string[];
  audioUrl: string;
  /** Per-scene caption strings from the plan (may be empty). */
  captions: string[];
  /** Full narration/script used when scene captions are missing. */
  narration?: string | null;
  durationSeconds: number;
  /**
   * Output frame shape. Defaults to "16:9"; the render pipeline and the
   * server worker both resolve these to concrete dimensions.
   */
  aspect?: "16:9" | "9:16" | "1:1";
  burnCaptions?: boolean;
  /** Story Mode: apply the five-beat template (pacing, captions, ducking). */
  storyMode?: boolean;
  /** Stable key (e.g. `job:<id>`) so a failed compose resumes rendered scenes. */
  runKey?: string;
  onProgress?: (p: RenderProgress) => void;
  signal?: AbortSignal;
};

const PLACEHOLDER_CAPTION = /^scene\s+\d+$/i;

/** True when a caption string is usable on-screen (not empty / not "Scene N"). */
export function isUsableCaption(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  if (PLACEHOLDER_CAPTION.test(t)) return false;
  return true;
}

/**
 * Resolve one caption string per scene image.
 * Prefers plan captions; fills gaps from narration/script chunks timed across scenes.
 */
export function resolveQuickJobCaptionTexts(
  captions: string[],
  sceneCount: number,
  narration?: string | null,
): string[] {
  const n = Math.max(1, sceneCount);
  const fromPlan = Array.from({ length: n }, (_, i) => (captions[i] ?? "").trim());
  if (fromPlan.every(isUsableCaption)) return fromPlan;

  const words = (narration ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const fromNarration: string[] = [];
  if (words.length > 0) {
    const per = Math.max(1, Math.ceil(words.length / n));
    for (let i = 0; i < n; i++) {
      const chunk = words.slice(i * per, (i + 1) * per).join(" ").trim();
      fromNarration.push(chunk || words.slice(0, Math.min(12, words.length)).join(" "));
    }
  }

  return fromPlan.map((c, i) => {
    if (isUsableCaption(c)) return c;
    if (fromNarration[i]) return fromNarration[i]!;
    return c || `Part ${i + 1}`;
  });
}

/**
 * Split a caption into readable overlay cues spread across the scene duration
 * (mirrors studio buildCues, kept client-safe / pure).
 */
export function buildSceneCaptionCues(
  text: string,
  sceneDuration: number,
  maxWords = 10,
): { start: number; end: number; text: string }[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const duration = Math.max(1.5, sceneDuration);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += maxWords) {
    chunks.push(words.slice(i, i + maxWords).join(" "));
  }
  const per = duration / chunks.length;
  const pad = Math.min(0.25, per * 0.08);
  return chunks.map((chunk, i) => ({
    start: Math.round((i * per + pad) * 100) / 100,
    end: Math.round(Math.min(duration - 0.1, (i + 1) * per - pad) * 100) / 100,
    text: chunk,
  }));
}

export function buildQuickJobScenes(
  images: string[],
  captions: string[],
  durationSeconds: number,
  narration?: string | null,
): RenderScene[] {
  const n = Math.max(1, images.length);
  const total = Math.max(n * 2, durationSeconds || n * 6);
  const per = total / n;
  const texts = resolveQuickJobCaptionTexts(captions, n, narration);

  return images.map((url, i) => {
    const caption = texts[i] ?? "";
    return {
      id: `qj-${i}`,
      number: i + 1,
      narration: caption,
      visualType: "AI_IMAGE",
      assetUrl: url,
      duration: per,
      audioUrl: null,
      cues: buildSceneCaptionCues(caption, per),
    };
  });
}

/** Compose stills + voiceover (+ captions) into a validated MP4 blob. */
export async function composeQuickJobMp4(input: QuickJobComposeInput): Promise<RenderResult> {
  if (!input.images.length) throw new Error("No scene visuals to compose.");
  if (!input.audioUrl) throw new Error("No voiceover to mux.");

  const { renderProject } = await import("./browser-render");
  const scenes = buildQuickJobScenes(
    input.images,
    input.captions,
    input.durationSeconds,
    input.narration,
  );

  return renderProject(scenes, {
    title: input.title || "Vidora video",
    aspect: input.aspect ?? "16:9",
    motion: "ken_burns",
    transition: "fade",
    captionStyle: "subtitle",
    burnCaptions: input.burnCaptions !== false,
    voiceoverUrl: input.audioUrl,
    ...(input.storyMode ? { creationMode: "story" } : {}),
    ...(input.runKey ? { runKey: input.runKey } : {}),
    ...(input.onProgress ? { onProgress: input.onProgress } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });
}
