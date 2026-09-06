/**
 * Mode 2 browser compose: trim source footage + mix ElevenLabs VO + burn captions.
 * Lazy-import only from client components (uses ffmpeg.wasm).
 */

import type { RenderCue, RenderProgress } from "./browser-render";

export type VoiceoverComposeInput = {
  title: string;
  sourceVideoUrl: string;
  voiceoverUrl: string | null;
  cues: RenderCue[];
  trimStart: number;
  trimEnd: number | null;
  muteOriginal: boolean;
  burnCaptions?: boolean;
  captionStyle?: string;
  aspect?: string;
  signal?: AbortSignal;
  onProgress?: (p: RenderProgress) => void;
};

export type VoiceoverComposeResult = {
  blob: Blob;
  duration: number;
  width: number;
  height: number;
  fileName: string;
};

function report(
  onProgress: VoiceoverComposeInput["onProgress"],
  stage: RenderProgress["stage"],
  progress: number,
  detail?: string,
) {
  onProgress?.({
    stage,
    label:
      stage === "init"
        ? "Starting renderer"
        : stage === "assets"
          ? "Loading footage"
          : stage === "narration"
            ? "Mixing voiceover"
            : stage === "captions"
              ? "Burning captions"
              : stage === "finalize"
                ? "Finalising MP4"
                : stage === "validate"
                  ? "Validating output"
                  : "Working",
    progress,
    detail,
  });
}

/**
 * Compose Mode 2 final MP4 in-browser.
 * Reuses the shared ffmpeg loader and caption PNG helpers from browser-render.
 */
export async function composeVoiceoverVideo(
  input: VoiceoverComposeInput,
): Promise<VoiceoverComposeResult> {
  const {
    loadFfmpeg,
    resolutionFor,
    safeFileName,
    RenderCancelled,
  } = await import("./browser-render");

  if (input.signal?.aborted) throw new RenderCancelled();

  report(input.onProgress, "init", 2);
  const ffmpeg = await loadFfmpeg();
  const { width, height } = resolutionFor(input.aspect ?? "16:9");
  const fps = 25;

  report(input.onProgress, "assets", 10, "Downloading source video");
  const srcRes = await fetch(input.sourceVideoUrl, { mode: "cors" });
  if (!srcRes.ok) throw new Error(`Could not download source video (HTTP ${srcRes.status}).`);
  const srcBytes = new Uint8Array(await srcRes.arrayBuffer());
  await ffmpeg.writeFile("source.mp4", srcBytes);

  let voName: string | null = null;
  if (input.voiceoverUrl) {
    report(input.onProgress, "narration", 25, "Downloading voiceover");
    const voRes = await fetch(input.voiceoverUrl, { mode: "cors" });
    if (!voRes.ok) throw new Error(`Could not download voiceover (HTTP ${voRes.status}).`);
    const voBytes = new Uint8Array(await voRes.arrayBuffer());
    voName = "voiceover.mp3";
    await ffmpeg.writeFile(voName, voBytes);
  }

  const trimStart = Math.max(0, input.trimStart || 0);
  const hasTrimEnd = input.trimEnd != null && Number(input.trimEnd) > trimStart;
  const trimDur = hasTrimEnd ? Number(input.trimEnd) - trimStart : null;

  // Caption overlays
  const { captionPngForCompose } = await import("./voiceover-captions");
  const burn = input.burnCaptions !== false;
  const cues = burn ? input.cues.filter((c) => c.text?.trim()) : [];
  const cueFiles: string[] = [];
  for (const [i, cue] of cues.entries()) {
    const png = await captionPngForCompose(cue.text, width, height, input.captionStyle);
    const name = `cue${i}.png`;
    await ffmpeg.writeFile(name, png);
    cueFiles.push(name);
  }

  report(input.onProgress, "segments" as RenderProgress["stage"], 45, "Trimming and mixing");

  const ffArgs: string[] = [];
  ffArgs.push("-ss", trimStart.toFixed(3));
  if (trimDur != null) ffArgs.push("-t", trimDur.toFixed(3));
  ffArgs.push("-i", "source.mp4");
  if (voName) ffArgs.push("-i", voName);
  for (const f of cueFiles) ffArgs.push("-i", f);

  const filters: string[] = [];
  filters.push(
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},setsar=1[base]`,
  );

  let last = "base";
  const voIndex = voName ? 1 : -1;
  const cueOffset = voName ? 2 : 1;
  cues.forEach((cue, i) => {
    const label = `ov${i}`;
    const start = Math.max(0, cue.start);
    const end = cue.end > cue.start ? cue.end : cue.start + 2.5;
    filters.push(
      `[${last}][${i + cueOffset}:v]overlay=0:0:enable='between(t,${start.toFixed(2)},${end.toFixed(2)})'[${label}]`,
    );
    last = label;
  });

  if (voName && !input.muteOriginal) {
    // Mix original + VO (VO louder)
    filters.push(
      `[0:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,volume=0.15[orig];` +
        `[${voIndex}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,volume=1.0[vo];` +
        `[orig][vo]amix=inputs=2:duration=first:dropout_transition=0[aout]`,
    );
  } else if (voName) {
    filters.push(
      `[${voIndex}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,afade=t=in:st=0:d=0.15[aout]`,
    );
  } else if (!input.muteOriginal) {
    filters.push(
      `[0:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[aout]`,
    );
  } else {
    ffArgs.push("-f", "lavfi", "-t", "3600", "-i", "anullsrc=r=44100:cl=stereo");
    const nullIdx = cueOffset + cues.length;
    filters.push(`[${nullIdx}:a]atrim=0:3600[aout]`);
  }

  const outName = "mode2_out.mp4";
  ffArgs.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    `[${last}]`,
    "-map",
    "[aout]",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "-shortest",
    "-y",
    outName,
  );

  if (input.signal?.aborted) throw new RenderCancelled();
  report(input.onProgress, "finalize", 70, "Encoding MP4");
  await ffmpeg.exec(ffArgs);

  report(input.onProgress, "validate", 92);
  const data = await ffmpeg.readFile(outName);
  if (typeof data === "string") throw new Error("Unexpected ffmpeg output");
  const blob = new Blob([data.slice().buffer as ArrayBuffer], { type: "video/mp4" });

  // cleanup best-effort
  for (const name of ["source.mp4", voName, outName, ...cueFiles].filter(Boolean) as string[]) {
    try {
      await ffmpeg.deleteFile(name);
    } catch {
      /* ignore */
    }
  }

  const duration =
    trimDur != null && trimDur > 0
      ? trimDur
      : await measureBlobDuration(blob);

  report(input.onProgress, "validate", 100, "Done");
  return {
    blob,
    duration,
    width,
    height,
    fileName: safeFileName(input.title, "-voiceover.mp4"),
  };
}

function measureBlobDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const d = Number.isFinite(video.duration) ? video.duration : 0;
      URL.revokeObjectURL(url);
      resolve(d);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
    video.src = url;
  });
}
