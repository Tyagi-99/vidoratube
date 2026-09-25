/**
 * Browser-side MP4 renderer (ffmpeg.wasm).
 *
 * Renders a Vidora project timeline into a genuine H.264/AAC MP4 entirely in
 * the user's browser — no cloud render service required. Work is split into
 * discrete stages and one scene at a time so long (15+ minute) projects do not
 * blow up browser memory: each finished scene segment is flushed to IndexedDB
 * and removed from the ffmpeg filesystem before the next scene starts.
 *
 * This module is browser-only. Import it lazily (dynamic import) from
 * components — never at module scope of an SSR route.
 */

import { segmentStore } from "./idb";

export type RenderStageId =
  | "init"
  | "assets"
  | "normalize"
  | "segments"
  | "combine"
  | "narration"
  | "music"
  | "captions"
  | "finalize"
  | "validate";

export type RenderProgress = {
  stage: RenderStageId;
  label: string;
  progress: number; // 0..100 overall
  detail?: string | undefined;
};

export type RenderCue = { start: number; end: number; text: string };

export type RenderScene = {
  id: string;
  number: number;
  narration: string;
  visualType: string;
  assetUrl: string | null;
  duration: number;
  audioUrl: string | null;
  cues: RenderCue[];
};

export type RenderOptions = {
  title: string;
  aspect: "16:9" | "9:16" | "1:1" | string;
  motion?: string;
  transition?: string;
  captionStyle?: string;
  burnCaptions?: boolean;
  musicUrl?: string | null;
  musicVolume?: number;
  /** Full-timeline voiceover mixed after scene join (quick-generate path). */
  voiceoverUrl?: string | null;
  mediaFit?: "cover" | "contain";
  fps?: number;
  onProgress?: (p: RenderProgress) => void;
  signal?: AbortSignal;
};

export class RenderCancelled extends Error {
  constructor() {
    super("Render cancelled");
    this.name = "RenderCancelled";
  }
}

export class SceneAssetError extends Error {
  sceneNumber: number;
  constructor(sceneNumber: number, message: string) {
    super(message);
    this.name = "SceneAssetError";
    this.sceneNumber = sceneNumber;
  }
}

const STAGE_LABELS: Record<RenderStageId, string> = {
  init: "Starting the renderer",
  assets: "Loading scenes",
  normalize: "Preparing images",
  segments: "Rendering scene segments",
  combine: "Combining scenes",
  narration: "Adding narration",
  music: "Adding background music",
  captions: "Burning captions",
  finalize: "Finalising MP4",
  validate: "Validating output",
};

export function resolutionFor(aspect: string): { width: number; height: number } {
  if (aspect === "9:16") return { width: 1080, height: 1920 };
  if (aspect === "1:1") return { width: 1080, height: 1080 };
  return { width: 1920, height: 1080 };
}

export function safeFileName(title: string, suffix: string) {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "vidora-video";
  return `${base}${suffix}`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatClock(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/* --------------------------- caption rendering --------------------------- */

type CaptionLook = { font: string; size: number; color: string; maxLines: number; bg: string };

function captionLook(style: string | undefined, height: number): CaptionLook {
  const unit = height / 1080;
  if (style === "sleep")
    return {
      font: `500 ${Math.round(40 * unit)}px Manrope, system-ui, sans-serif`,
      size: Math.round(40 * unit),
      color: "rgba(255,255,255,0.82)",
      maxLines: 2,
      bg: "rgba(0,0,0,0)",
    };
  if (style === "dynamic")
    return {
      font: `800 ${Math.round(64 * unit)}px Sora, system-ui, sans-serif`,
      size: Math.round(64 * unit),
      color: "#ffffff",
      maxLines: 2,
      bg: "rgba(0,0,0,0.35)",
    };
  return {
    font: `600 ${Math.round(50 * unit)}px Manrope, system-ui, sans-serif`,
    size: Math.round(50 * unit),
    color: "#ffffff",
    maxLines: 3,
    bg: "rgba(0,0,0,0.28)",
  };
}

/** Draws a caption cue to a transparent PNG so we never depend on ffmpeg fonts. */
async function captionPng(text: string, width: number, height: number, style?: string): Promise<Uint8Array> {
  const look = captionLook(style, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.font = look.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const maxWidth = width * 0.82;
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  const shown = lines.slice(0, look.maxLines);

  const lineHeight = look.size * 1.3;
  const blockHeight = shown.length * lineHeight;
  const bottom = height - height * 0.08;
  const top = bottom - blockHeight;

  if (look.bg !== "rgba(0,0,0,0)") {
    const widest = Math.max(...shown.map((l) => ctx.measureText(l).width));
    const pad = look.size * 0.5;
    ctx.fillStyle = look.bg;
    ctx.beginPath();
    const x = width / 2 - widest / 2 - pad;
    const y = top - pad * 0.6;
    const w = widest + pad * 2;
    const h = blockHeight + pad * 1.2;
    const r = look.size * 0.3;
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
  }

  ctx.shadowColor = "rgba(0,0,0,0.75)";
  ctx.shadowBlur = look.size * 0.25;
  ctx.fillStyle = look.color;
  shown.forEach((line, i) => {
    ctx.fillText(line, width / 2, top + lineHeight * (i + 0.5));
  });

  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Caption rendering failed"))), "image/png"),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

/* ------------------------------- utilities ------------------------------- */

function throwIfCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new RenderCancelled();
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function extFromUrl(url: string, fallback: string) {
  const clean = url.split("?")[0] ?? "";
  const match = /\.([a-z0-9]{2,4})$/i.exec(clean);
  return (match?.[1] ?? fallback).toLowerCase();
}

/** Measures real playback duration of an audio/video url in the browser. */
export function mediaDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement("audio");
    el.preload = "metadata";
    el.onloadedmetadata = () => resolve(Number.isFinite(el.duration) ? el.duration : 0);
    el.onerror = () => resolve(0);
    el.src = url;
  });
}

/* --------------------------------- core ---------------------------------- */

type Ffmpeg = import("@ffmpeg/ffmpeg").FFmpeg;

let ffmpegSingleton: Ffmpeg | null = null;

export async function loadFfmpeg(onLog?: (line: string) => void): Promise<Ffmpeg> {
  if (ffmpegSingleton) return ffmpegSingleton;
  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  // FFmpeg v0.12 spawns its worker with `type: "module"`, so it needs a module
  // worker + the ESM core (a classic/UMD script makes importScripts throw inside
  // a module worker). The worker is our own module bundled by Vite; the core js
  // and wasm are served same-origin (no CDN dependency).
  const [{ default: workerUrl }, { default: coreWasmAsset }] = await Promise.all([
    import("./ffmpeg-worker?worker&url"),
    import("./ffmpeg-core-wasm.asset.json"),
  ]);

  // The wasm core is vendored at build/dev time by scripts/fetch-ffmpeg-wasm.mjs
  // into public/wasm/, so it works on any host. If that file is absent (e.g. a
  // deploy pipeline that skipped the prebuild step), fall back to the
  // Lovable-hosted asset URL.
  const coreURL = new URL("/wasm/ffmpeg-core-esm.js", window.location.origin).href;
  const localWasmURL = new URL("/wasm/ffmpeg-core.wasm", window.location.origin).href;
  const remoteWasmURL = new URL(coreWasmAsset.url, window.location.origin).href;
  const wasmCandidates = localWasmURL === remoteWasmURL ? [localWasmURL] : [localWasmURL, remoteWasmURL];

  const describe = (error: unknown) =>
    error instanceof Error && error.message
      ? error.message
      : typeof error === "string"
        ? error
        : "download or worker startup failed — check your connection and reload";

  let lastError: unknown = null;
  for (const wasmURL of wasmCandidates) {
    // A fresh instance per attempt: a failed load must not poison the singleton.
    const attempt = new FFmpeg();
    if (onLog) attempt.on("log", ({ message }) => onLog(message));
    try {
      await attempt.load({
        // Module workers resolve dynamic imports poorly from relative paths —
        // hand the worker fully-qualified same-origin URLs.
        coreURL,
        wasmURL,
        classWorkerURL: workerUrl,
      });
      ffmpegSingleton = attempt;
      return attempt;
    } catch (error) {
      lastError = error;
      try {
        attempt.terminate();
      } catch {
        /* already torn down */
      }
    }
  }
  throw new Error(
    `FFmpeg could not start in this browser (${describe(lastError)}). Try Chrome, Firefox or Brave with a normal (non-private) window.`,
  );
}

export async function releaseFfmpeg() {
  try {
    ffmpegSingleton?.terminate();
  } catch {
    /* already gone */
  }
  ffmpegSingleton = null;
}

function motionFilter(motion: string | undefined, frames: number, width: number, height: number) {
  const z = "zoom";
  const centre = { x: `iw/2-(iw/${z}/2)`, y: `ih/2-(ih/${z}/2)` };
  const common = `:d=1:s=${width}x${height}`;
  switch (motion) {
    case "slow_pan":
    case "pan_left_right":
      return `zoompan=z='1.15':x='(iw-iw/zoom)*on/${frames}':y='ih/2-(ih/zoom/2)'${common}`;
    case "pan_right_left":
      return `zoompan=z='1.15':x='(iw-iw/zoom)*(1-on/${frames})':y='ih/2-(ih/zoom/2)'${common}`;
    case "zoom_out":
      return `zoompan=z='if(eq(on,0),1.2,max(zoom-${(0.2 / frames).toFixed(6)},1.0))':x='${centre.x}':y='${centre.y}'${common}`;
    case "none":
      return `zoompan=z='1.0':x='${centre.x}':y='${centre.y}'${common}`;
    case "slow_zoom":
    case "ken_burns":
    default:
      return `zoompan=z='min(zoom+${(0.18 / frames).toFixed(6)},1.18)':x='${centre.x}':y='${centre.y}'${common}`;
  }
}

function transitionFades(transition: string | undefined, duration: number) {
  if (transition === "cut") return "";
  const d = transition === "dip_to_black" ? 0.6 : 0.45;
  const out = Math.max(0, duration - d);
  return `,fade=t=in:st=0:d=${d},fade=t=out:st=${out.toFixed(3)}:d=${d}`;
}

export type SceneRenderResult = { blob: Blob; duration: number };

/**
 * Renders a single scene to an MP4 segment. Used both by the full-project
 * renderer and by the per-scene "Render scene" preview in the editor.
 */
export async function renderScene(
  ffmpeg: Ffmpeg,
  scene: RenderScene,
  options: RenderOptions,
  index = 0,
): Promise<SceneRenderResult> {
  const { width, height } = resolutionFor(options.aspect);
  const fps = options.fps ?? 25;
  const signal = options.signal;
  throwIfCancelled(signal);

  const prefix = `s${index}`;
  const written: string[] = [];
  const write = async (name: string, bytes: Uint8Array) => {
    await ffmpeg.writeFile(name, bytes);
    written.push(name);
  };

  try {
    if (!scene.assetUrl) throw new SceneAssetError(scene.number, `Scene ${scene.number} has no visual asset.`);

    const isVideo = scene.visualType === "STOCK_VIDEO";
    let visualBytes: Uint8Array;
    try {
      visualBytes = await fetchBytes(scene.assetUrl);
    } catch (error) {
      throw new SceneAssetError(
        scene.number,
        `Scene ${scene.number} visual could not be downloaded (${(error as Error).message}).`,
      );
    }
    const visualName = `${prefix}_v.${extFromUrl(scene.assetUrl, isVideo ? "mp4" : "jpg")}`;
    await write(visualName, visualBytes);

    let duration = Number(scene.duration) || 6;
    let audioName: string | null = null;
    if (scene.audioUrl) {
      try {
        const audioBytes = await fetchBytes(scene.audioUrl);
        audioName = `${prefix}_a.${extFromUrl(scene.audioUrl, "mp3")}`;
        await write(audioName, audioBytes);
        const measured = await mediaDuration(scene.audioUrl);
        if (measured > 0.4) duration = measured + 0.5;
      } catch (error) {
        throw new SceneAssetError(
          scene.number,
          `Scene ${scene.number} voiceover could not be decoded (${(error as Error).message}).`,
        );
      }
    }
    duration = Math.min(Math.max(duration, 1.5), 120);
    const frames = Math.max(2, Math.round(duration * fps));

    /* caption overlays as transparent PNGs (no ffmpeg font dependency) */
    const cues = options.burnCaptions === false ? [] : scene.cues.filter((c) => c.text?.trim());
    const cueNames: string[] = [];
    for (const [i, cue] of cues.entries()) {
      const png = await captionPng(cue.text, width, height, options.captionStyle);
      const name = `${prefix}_c${i}.png`;
      await write(name, png);
      cueNames.push(name);
    }

    const args: string[] = [];
    if (isVideo) {
      args.push("-stream_loop", "-1", "-t", duration.toFixed(3), "-i", visualName);
    } else {
      args.push("-loop", "1", "-framerate", String(fps), "-t", duration.toFixed(3), "-i", visualName);
    }
    if (audioName) args.push("-i", audioName);
    for (const name of cueNames) args.push("-i", name);

    const fit =
      options.mediaFit === "contain"
        ? `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`
        : `scale=${Math.round(width * 1.4)}:${Math.round(height * 1.4)}:force_original_aspect_ratio=increase,crop=${Math.round(width * 1.4)}:${Math.round(height * 1.4)}`;

    const chain: string[] = [];
    if (isVideo) {
      chain.push(
        `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},setsar=1${transitionFades(options.transition, duration)}[base]`,
      );
    } else {
      chain.push(
        `[0:v]${fit},setsar=1,${motionFilter(options.motion, frames, width, height)},fps=${fps}${transitionFades(options.transition, duration)}[base]`,
      );
    }

    let last = "base";
    const audioInputIndex = audioName ? 1 : -1;
    const cueOffset = audioName ? 2 : 1;
    cues.forEach((cue, i) => {
      const label = `ov${i}`;
      const start = Math.max(0, cue.start);
      const end = Math.min(duration, cue.end > cue.start ? cue.end : cue.start + 2.5);
      chain.push(
        `[${last}][${i + cueOffset}:v]overlay=0:0:enable='between(t,${start.toFixed(2)},${end.toFixed(2)})'[${label}]`,
      );
      last = label;
    });

    if (audioInputIndex >= 0) {
      chain.push(
        `[${audioInputIndex}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,afade=t=in:st=0:d=0.25,apad,atrim=0:${duration.toFixed(3)},asetpts=N/SR/TB[aout]`,
      );
    } else {
      args.push("-f", "lavfi", "-t", duration.toFixed(3), "-i", "anullsrc=r=44100:cl=stereo");
      chain.push(`[${cueOffset + cues.length}:a]atrim=0:${duration.toFixed(3)}[aout]`);
    }

    const output = `${prefix}_out.mp4`;
    args.push(
      "-filter_complex",
      chain.join(";"),
      "-map",
      `[${last}]`,
      "-map",
      "[aout]",
      "-t",
      duration.toFixed(3),
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "26",
      "-pix_fmt",
      "yuv420p",
      "-r",
      String(fps),
      "-g",
      String(fps * 2),
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ar",
      "44100",
      "-ac",
      "2",
      "-movflags",
      "+faststart",
      "-y",
      output,
    );

    await ffmpeg.exec(args);
    throwIfCancelled(signal);

    const data = (await ffmpeg.readFile(output)) as Uint8Array;
    if (!data || data.length === 0)
      throw new SceneAssetError(scene.number, `Scene ${scene.number} produced an empty segment.`);
    const blob = new Blob([data.slice().buffer as ArrayBuffer], { type: "video/mp4" });
    written.push(output);
    return { blob, duration };
  } finally {
    // free every temporary file so long renders do not accumulate memory
    for (const name of written) {
      try {
        await ffmpeg.deleteFile(name);
      } catch {
        /* already removed */
      }
    }
  }
}

export type RenderResult = {
  blob: Blob;
  duration: number;
  width: number;
  height: number;
  fileName: string;
};

export async function renderProject(scenes: RenderScene[], options: RenderOptions): Promise<RenderResult> {
  const { width, height } = resolutionFor(options.aspect);
  const signal = options.signal;
  const report = (stage: RenderStageId, progress: number, detail?: string) =>
    options.onProgress?.({ stage, label: STAGE_LABELS[stage], progress: Math.round(progress), detail });

  const usable = scenes.filter((s) => s.assetUrl);
  if (usable.length === 0) throw new Error("This project has no scene visuals yet — generate the assets first.");

  report("init", 2);
  const ffmpeg = await loadFfmpeg();
  throwIfCancelled(signal);

  report("assets", 6, `${usable.length} scenes queued`);
  const runId = `r${Date.now()}`;
  const segmentKeys: string[] = [];
  let totalDuration = 0;

  try {
    /* Stages 1–3: per-scene assets, normalisation and segment encoding. */
    for (const [i, scene] of usable.entries()) {
      throwIfCancelled(signal);
      report("segments", 8 + (62 * i) / usable.length, `Scene ${scene.number} of ${usable.length}`);
      const { blob, duration } = await renderScene(ffmpeg, scene, options, i);
      totalDuration += duration;
      const key = `${runId}/seg-${String(i).padStart(4, "0")}`;
      await segmentStore.put(key, blob);
      segmentKeys.push(key);
      report("segments", 8 + (62 * (i + 1)) / usable.length, `Scene ${scene.number} done`);
    }

    /* Stage 4: combine segments (stream copy — identical encode settings). */
    throwIfCancelled(signal);
    report("combine", 74, "Joining scene segments");
    const listLines: string[] = [];
    for (const [i, key] of segmentKeys.entries()) {
      const blob = await segmentStore.get(key);
      if (!blob) throw new Error("A rendered segment went missing from browser storage.");
      const name = `seg${String(i).padStart(4, "0")}.mp4`;
      await ffmpeg.writeFile(name, new Uint8Array(await blob.arrayBuffer()));
      listLines.push(`file '${name}'`);
    }
    await ffmpeg.writeFile("list.txt", new TextEncoder().encode(listLines.join("\n")));
    await ffmpeg.exec(["-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", "-y", "joined.mp4"]);
    for (let i = 0; i < segmentKeys.length; i++) {
      await ffmpeg.deleteFile(`seg${String(i).padStart(4, "0")}.mp4`).catch(() => undefined);
    }

    /* Stages 5–7: optional full-timeline voiceover, then music with ducking. */
    report("narration", 82, options.voiceoverUrl ? "Mixing voiceover" : "Narration mixed per scene");
    let finalName = "joined.mp4";

    if (options.voiceoverUrl) {
      throwIfCancelled(signal);
      try {
        const vo = await fetchBytes(options.voiceoverUrl);
        const voName = `vo.${extFromUrl(options.voiceoverUrl, "mp3")}`;
        await ffmpeg.writeFile(voName, vo);
        await ffmpeg.exec([
          "-i",
          finalName,
          "-i",
          voName,
          "-map",
          "0:v",
          "-map",
          "1:a",
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-b:a",
          "160k",
          "-ar",
          "44100",
          "-ac",
          "2",
          "-shortest",
          "-movflags",
          "+faststart",
          "-y",
          "voiced.mp4",
        ]);
        await ffmpeg.deleteFile(voName).catch(() => undefined);
        await ffmpeg.deleteFile(finalName).catch(() => undefined);
        finalName = "voiced.mp4";
      } catch (error) {
        throw new Error(`Voiceover mux failed: ${(error as Error).message}`);
      }
    }

    if (options.musicUrl) {
      throwIfCancelled(signal);
      report("music", 86, "Mixing background music with ducking");
      try {
        const music = await fetchBytes(options.musicUrl);
        const musicName = `music.${extFromUrl(options.musicUrl, "mp3")}`;
        await ffmpeg.writeFile(musicName, music);
        const vol = options.musicVolume ?? 0.12;
        await ffmpeg.exec([
          "-i",
          finalName,
          "-stream_loop",
          "-1",
          "-i",
          musicName,
          "-filter_complex",
          `[1:a]volume=${vol},afade=t=in:st=0:d=2[bed];[bed][0:a]sidechaincompress=threshold=0.03:ratio=8:attack=25:release=400[duck];[0:a][duck]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[mix]`,
          "-map",
          "0:v",
          "-map",
          "[mix]",
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-b:a",
          "160k",
          "-shortest",
          "-movflags",
          "+faststart",
          "-y",
          "mixed.mp4",
        ]);
        await ffmpeg.deleteFile(musicName).catch(() => undefined);
        await ffmpeg.deleteFile(finalName).catch(() => undefined);
        finalName = "mixed.mp4";
      } catch (error) {
        report("music", 88, `Music skipped: ${(error as Error).message}`);
      }
    }

    report("captions", 90, "Captions burned into each scene");

    /* Stage 8–9: finalise and validate. */
    throwIfCancelled(signal);
    report("finalize", 94, "Writing MP4 container");
    const data = (await ffmpeg.readFile(finalName)) as Uint8Array;
    await ffmpeg.deleteFile(finalName).catch(() => undefined);
    await ffmpeg.deleteFile("list.txt").catch(() => undefined);

    report("validate", 97, "Checking the output plays");
    if (!data || data.length < 1024) throw new Error("The renderer produced an unreadable file. Please retry.");
    const blob = new Blob([data.slice().buffer as ArrayBuffer], { type: "video/mp4" });
    const playable = await canPlay(blob);
    if (!playable) throw new Error("The rendered file failed playback validation. Please retry the render.");

    report("validate", 100, "Done");
    return {
      blob,
      duration: totalDuration,
      width,
      height,
      fileName: safeFileName(options.title, ".mp4"),
    };
  } finally {
    await segmentStore.clearPrefix(runId).catch(() => undefined);
  }
}

function canPlay(blob: Blob): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.preload = "metadata";
    const done = (ok: boolean) => {
      URL.revokeObjectURL(url);
      resolve(ok);
    };
    video.onloadedmetadata = () => done(video.duration > 0);
    video.onerror = () => done(false);
    video.src = url;
    setTimeout(() => done(true), 8000);
  });
}
