/**
 * Mode 2 browser compose: trim source footage + mix ElevenLabs VO + burn captions.
 * Lazy-import only from client components (uses ffmpeg.wasm).
 */

import type { RenderCue, RenderProgress } from "./browser-render";
import { measureMediaDuration, validatePlayback } from "./validate-playback";

/**
 * Shifts caption cues by the head-trim so burned captions stay in sync with
 * the trimmed video. Cues fully inside the trimmed region are dropped.
 * Pure — covered by unit tests.
 */
export function adjustCuesForTrim(cues: RenderCue[], trimStart: number): RenderCue[] {
  if (!(trimStart > 0)) return cues;
  return cues
    .map((cue) => ({ ...cue, start: cue.start - trimStart, end: cue.end - trimStart }))
    .filter((cue) => cue.end > 0)
    .map((cue) => (cue.start < 0 ? { ...cue, start: 0 } : cue));
}

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
    execFfmpeg,
    blobFromBytes,
    mediaDuration,
    resolutionFor,
    safeFileName,
    RenderCancelled,
  } = await import("./browser-render");

  if (input.signal?.aborted) throw new RenderCancelled();

  report(input.onProgress, "init", 2);
  const ffmpeg = await loadFfmpeg();
  const { width, height } = resolutionFor(input.aspect ?? "16:9");
  const fps = 25;
  // Namespaced temp files so concurrent composes never share FS state.
  const tag = `vc${Date.now().toString(36)}`;
  const srcName = `${tag}_source.mp4`;
  const outName = `${tag}_mode2_out.mp4`;

  report(input.onProgress, "assets", 10, "Downloading source video");
  const srcRes = await fetch(input.sourceVideoUrl, { mode: "cors" });
  if (!srcRes.ok) throw new Error(`Could not download source video (HTTP ${srcRes.status}).`);
  const srcBytes = new Uint8Array(await srcRes.arrayBuffer());
  await ffmpeg.writeFile(srcName, srcBytes);

  let voName: string | null = null;
  if (input.voiceoverUrl) {
    report(input.onProgress, "narration", 25, "Downloading voiceover");
    const voRes = await fetch(input.voiceoverUrl, { mode: "cors" });
    if (!voRes.ok) throw new Error(`Could not download voiceover (HTTP ${voRes.status}).`);
    const voBytes = new Uint8Array(await voRes.arrayBuffer());
    voName = `${tag}_voiceover.mp3`;
    await ffmpeg.writeFile(voName, voBytes);
  }

  const trimStart = Math.max(0, input.trimStart || 0);
  const hasTrimEnd = input.trimEnd != null && Number(input.trimEnd) > trimStart;
  const trimDur = hasTrimEnd ? Number(input.trimEnd) - trimStart : null;

  // Caption overlays — cue timestamps are shifted by the head-trim so they
  // stay in sync with the trimmed video (untrimmed cues would all run late).
  const { captionPngForCompose } = await import("./voiceover-captions");
  const burn = input.burnCaptions !== false;
  const cues = adjustCuesForTrim(
    burn ? input.cues.filter((c) => c.text?.trim()) : [],
    trimStart,
  );
  const cueFiles: string[] = [];
  for (const [i, cue] of cues.entries()) {
    const png = await captionPngForCompose(cue.text, width, height, input.captionStyle);
    const name = `${tag}_cue${i}.png`;
    await ffmpeg.writeFile(name, png);
    cueFiles.push(name);
  }

  report(input.onProgress, "segments" as RenderProgress["stage"], 45, "Trimming and mixing");

  const ffArgs: string[] = [];
  ffArgs.push("-ss", trimStart.toFixed(3));
  if (trimDur != null) ffArgs.push("-t", trimDur.toFixed(3));
  ffArgs.push("-i", srcName);
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
    // Muted with no voiceover: synthesize silence only as long as needed
    // instead of a wasteful fixed 1-hour track.
    const sourceLen = await mediaDuration(input.sourceVideoUrl);
    const silenceLen = trimDur != null && trimDur > 0 ? trimDur : sourceLen > 0 ? sourceLen : 3600;
    ffArgs.push("-f", "lavfi", "-t", silenceLen.toFixed(3), "-i", "anullsrc=r=44100:cl=stereo");
    const nullIdx = cueOffset + cues.length;
    filters.push(`[${nullIdx}:a]atrim=0:${silenceLen.toFixed(3)}[aout]`);
  }

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
  await execFfmpeg(ffmpeg, ffArgs, "trimming and mixing voiceover", { signal: input.signal });

  report(input.onProgress, "validate", 92);
  const data = await ffmpeg.readFile(outName);
  if (typeof data === "string") throw new Error("Unexpected ffmpeg output");
  // No .slice(): the Blob copies the bytes itself — one less full heap copy.
  const blob = blobFromBytes(data);

  // cleanup best-effort
  for (const name of [srcName, voName, outName, ...cueFiles].filter(Boolean) as string[]) {
    try {
      await ffmpeg.deleteFile(name);
    } catch {
      /* ignore */
    }
  }

  const duration =
    trimDur != null && trimDur > 0 ? trimDur : await measureMediaDuration(blob);
  const playable = await validatePlayback(blob, duration);
  if (!playable) throw new Error("The composed file failed playback validation. Please retry.");

  report(input.onProgress, "validate", 100, "Done");
  return {
    blob,
    duration,
    width,
    height,
    fileName: safeFileName(input.title, "-voiceover.mp4"),
  };
}
