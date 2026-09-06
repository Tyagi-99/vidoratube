/**
 * Client-side compose for quick-generate video_jobs when Shotstack is absent.
 * Reuses browser-render (ffmpeg.wasm) — does not alter the studio RenderPanel path.
 */

import type { RenderProgress, RenderResult, RenderScene } from "./browser-render";

export type QuickJobComposeInput = {
  title: string;
  images: string[];
  audioUrl: string;
  captions: string[];
  durationSeconds: number;
  burnCaptions?: boolean;
  onProgress?: (p: RenderProgress) => void;
  signal?: AbortSignal;
};

export function buildQuickJobScenes(
  images: string[],
  captions: string[],
  durationSeconds: number,
): RenderScene[] {
  const n = Math.max(1, images.length);
  const total = Math.max(n * 2, durationSeconds || n * 6);
  const per = total / n;
  return images.map((url, i) => {
    const caption = (captions[i] ?? "").trim();
    return {
      id: `qj-${i}`,
      number: i + 1,
      narration: caption,
      visualType: "AI_IMAGE",
      assetUrl: url,
      duration: per,
      audioUrl: null,
      cues: caption
        ? [{ start: 0.25, end: Math.max(1.2, per - 0.35), text: caption }]
        : [],
    };
  });
}

/** Compose stills + voiceover (+ captions) into a validated MP4 blob. */
export async function composeQuickJobMp4(input: QuickJobComposeInput): Promise<RenderResult> {
  if (!input.images.length) throw new Error("No scene visuals to compose.");
  if (!input.audioUrl) throw new Error("No voiceover to mux.");

  const { renderProject } = await import("./browser-render");
  const scenes = buildQuickJobScenes(input.images, input.captions, input.durationSeconds);

  return renderProject(scenes, {
    title: input.title || "Vidora video",
    aspect: "16:9",
    motion: "ken_burns",
    transition: "fade",
    captionStyle: "subtitle",
    burnCaptions: input.burnCaptions !== false,
    voiceoverUrl: input.audioUrl,
    ...(input.onProgress ? { onProgress: input.onProgress } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });
}
