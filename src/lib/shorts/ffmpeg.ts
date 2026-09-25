/**
 * Long-form → Shorts: 9:16 cut + burned-in captions — Sprint 5-6.
 *
 * The worker renders each selected Short from the finished long video:
 *   1. Seek to the window (`-ss` before `-i` for a fast, accurate seek).
 *   2. 9:16 crop from the source frame: `crop=in_h*9/16:in_h` takes a
 *      centered vertical slice of a 16:9 (or wider) source, then
 *      `scale=1080:1920` normalizes to the Shorts delivery size.
 *   3. Burn captions: the `ass=` filter burns the window's ASS subtitle
 *      file (built by buildWordAss with the source project's language row —
 *      same caption pipeline as the full render) into the picture.
 *   4. Re-encode video (libx264, faststart for streaming) and audio (AAC);
 *      the narration/music/SFX mix is carried from the source window.
 *
 * Pure arg builder — the worker executes these; unit tests assert the
 * caption burn-in and 9:16 geometry are present.
 */

/** Escape a subtitle path for use inside an ffmpeg filtergraph. */
export function escapeFilterPath(path: string): string {
  // Inside -vf, the chars ' : , ; [ ] need backslash-escaping.
  return path.replace(/([':;,[\]])/g, "\\$1");
}

export interface ShortCutArgs {
  /** Source video path (the finished long render). */
  input: string;
  /** Window start, seconds from the start of the source. */
  start: number;
  /** Window length in seconds. */
  duration: number;
  /** ASS subtitle file for this window (burned in). */
  assPath: string;
  /** Output MP4 path. */
  output: string;
  /** Video bitrate, e.g. "6M". */
  videoBitrate?: string;
}

/** Build the ffmpeg argv for one Short. Pure. */
export function buildShortCutArgs(args: ShortCutArgs): string[] {
  const start = Math.max(0, args.start);
  const duration = Math.max(0, args.duration);
  const vf = [
    "crop=in_h*9/16:in_h",
    "scale=1080:1920",
    `ass='${escapeFilterPath(args.assPath)}'`,
  ].join(",");
  return [
    "-y",
    "-ss",
    start.toFixed(3),
    "-t",
    duration.toFixed(3),
    "-i",
    args.input,
    "-vf",
    vf,
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-b:v",
    args.videoBitrate ?? "6M",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    args.output,
  ];
}
