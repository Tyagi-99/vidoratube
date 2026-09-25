/**
 * Sprint 5-6: platform-ready export presets.
 *
 * Each preset pins the full output spec for a publishing target: MP4
 * container, H.264 High profile, AAC 48 kHz stereo audio, +faststart, and the
 * platform's native frame size. The browser render path (renderProject in
 * src/lib/render/browser-render.ts) uses these when `options.exportPreset` is
 * set; `exportEncodeArgs()` is the single source of truth for the ffmpeg
 * output flags, so the presets and the renderer can never drift apart.
 *
 * The defaults (no preset selected) are untouched: ultrafast/crf-26/44.1kHz
 * remains the fast free browser preview. Presets trade a little speed for
 * platform-grade output (veryfast/crf-23/48kHz).
 */

export type ExportPresetId =
  | "youtube-longform"
  | "youtube-shorts"
  | "instagram-reels"
  | "tiktok";

export interface ExportPreset {
  id: ExportPresetId;
  /** Platform name shown in the picker. */
  platform: string;
  /** Full label with aspect, shown in the picker. */
  label: string;
  /** Compact label for badges. */
  shortLabel: string;
  width: number;
  height: number;
  fps: number;
  container: "mp4";
  videoCodec: "libx264";
  videoProfile: "high";
  pixelFormat: "yuv420p";
  /** x264 speed/quality trade-off for the browser renderer. */
  x264Preset: "veryfast";
  crf: number;
  audioCodec: "aac";
  audioBitrate: string;
  audioSampleRate: 48000;
  audioChannels: 2;
  movflags: "+faststart";
}

const base = {
  fps: 30,
  container: "mp4",
  videoCodec: "libx264",
  videoProfile: "high",
  pixelFormat: "yuv420p",
  x264Preset: "veryfast",
  crf: 23,
  audioCodec: "aac",
  audioBitrate: "160k",
  audioSampleRate: 48000,
  audioChannels: 2,
  movflags: "+faststart",
} as const;

export const EXPORT_PRESETS: Record<ExportPresetId, ExportPreset> = {
  "youtube-longform": {
    ...base,
    id: "youtube-longform",
    platform: "YouTube",
    label: "YouTube · Long-form (16:9) — 1920×1080",
    shortLabel: "YouTube 16:9",
    width: 1920,
    height: 1080,
  },
  "youtube-shorts": {
    ...base,
    id: "youtube-shorts",
    platform: "YouTube",
    label: "YouTube · Shorts (9:16) — 1080×1920",
    shortLabel: "Shorts 9:16",
    width: 1080,
    height: 1920,
  },
  "instagram-reels": {
    ...base,
    id: "instagram-reels",
    platform: "Instagram",
    label: "Instagram · Reels (9:16) — 1080×1920",
    shortLabel: "Reels 9:16",
    width: 1080,
    height: 1920,
  },
  tiktok: {
    ...base,
    id: "tiktok",
    platform: "TikTok",
    label: "TikTok (9:16) — 1080×1920",
    shortLabel: "TikTok 9:16",
    width: 1080,
    height: 1920,
  },
};

export const EXPORT_PRESET_IDS = Object.keys(EXPORT_PRESETS) as ExportPresetId[];

/** Unknown ids resolve to undefined — callers fall back to the default path. */
export function exportPresetById(id: string | null | undefined): ExportPreset | undefined {
  if (!id) return undefined;
  return (EXPORT_PRESETS as Record<string, ExportPreset>)[id];
}

/**
 * Sensible default for a project aspect ratio. "1:1" has no dedicated
 * platform preset in scope (the four targets above are the deliverable), so
 * square projects default to the long-form encode settings; the user can
 * still pick any preset explicitly.
 */
export function defaultExportPresetForAspect(aspect: string): ExportPresetId {
  return aspect === "9:16" ? "youtube-shorts" : "youtube-longform";
}

export function resolutionForExportPreset(id: ExportPresetId): { width: number; height: number } {
  const p = EXPORT_PRESETS[id];
  return { width: p.width, height: p.height };
}

/**
 * Exact ffmpeg OUTPUT flags for a preset: H.264 High, AAC 48 kHz stereo,
 * +faststart. `fps` comes from the render options (-r/-g stay in sync with
 * the renderer's frame rate).
 */
export function exportEncodeArgs(preset: ExportPreset, fps: number): string[] {
  return [
    "-c:v",
    preset.videoCodec,
    "-profile:v",
    preset.videoProfile,
    "-pix_fmt",
    preset.pixelFormat,
    "-preset",
    preset.x264Preset,
    "-crf",
    String(preset.crf),
    "-r",
    String(fps),
    "-g",
    String(fps * 2),
    "-c:a",
    preset.audioCodec,
    "-b:a",
    preset.audioBitrate,
    "-ar",
    String(preset.audioSampleRate),
    "-ac",
    String(preset.audioChannels),
    "-movflags",
    preset.movflags,
  ];
}

/**
 * Audio-only output flags for the copy-video mux stages (voiceover attach,
 * music mix): re-encode audio to the preset spec while the video stream is
 * stream-copied.
 */
export function exportAudioEncodeArgs(preset: ExportPreset): string[] {
  return [
    "-c:a",
    preset.audioCodec,
    "-b:a",
    preset.audioBitrate,
    "-ar",
    String(preset.audioSampleRate),
    "-ac",
    String(preset.audioChannels),
  ];
}
