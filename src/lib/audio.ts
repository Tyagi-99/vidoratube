/**
 * P4 audio helpers — background music ducking under voiceover/narration.
 *
 * Shared by both render paths:
 * - worker/src/pipeline.ts (native FFmpeg)
 * - src/lib/render/browser-render.ts (FFmpeg.wasm)
 *
 * Ducking uses sidechaincompress: the voice bus drives a compressor on the
 * music bus, so music dips while someone is speaking and swells back in
 * pauses. Pure string builders so they are unit-testable without FFmpeg.
 */

export interface DuckingOptions {
  /** Music bus label, e.g. "[music]". */
  musicLabel: string;
  /** Voice (sidechain) bus label, e.g. "[voice]". */
  voiceLabel: string;
  /** Output label, e.g. "[ducked]". */
  outLabel: string;
  /** How far the music dips while voice is present (dB). Default 12. */
  dipDb?: number;
  /** Compressor attack in ms. Default 200. */
  attackMs?: number;
  /** Compressor release in ms. Default 800. */
  releaseMs?: number;
}

/**
 * Builds a sidechaincompress filter that ducks `musicLabel` under `voiceLabel`.
 *
 * Example: buildDuckingFilter({ musicLabel: "[music]", voiceLabel: "[voice]",
 *   outLabel: "[ducked]" })
 * → "[music][voice]sidechaincompress=threshold=0.02:ratio=8:attack=200:release=800:makeup=1[ducked]"
 */
export function buildDuckingFilter(opts: DuckingOptions): string {
  const dipDb = opts.dipDb ?? 12;
  // Map dip dB to a compression ratio: 12dB ≈ ratio 8 with a low threshold.
  const ratio = Math.max(2, Math.min(20, Math.round(dipDb * 0.7)));
  const attack = opts.attackMs ?? 200;
  const release = opts.releaseMs ?? 800;
  const strip = (l: string) => l.replace(/^\[|\]$/g, "");
  return (
    `[${strip(opts.musicLabel)}][${strip(opts.voiceLabel)}]` +
    `sidechaincompress=threshold=0.02:ratio=${ratio}:attack=${attack}:release=${release}:makeup=1` +
    `[${strip(opts.outLabel)}]`
  );
}

export interface MusicFadeOptions {
  label: string;
  outLabel: string;
  /** Total track duration in seconds. */
  duration: number;
  /** Fade-in seconds. Default 1. */
  fadeIn?: number;
  /** Fade-out seconds. Default 2. */
  fadeOut?: number;
}

/** Builds afade in/out for a music bed of known duration. */
export function buildMusicFade(opts: MusicFadeOptions): string {
  const fadeIn = opts.fadeIn ?? 1;
  const fadeOut = opts.fadeOut ?? 2;
  const strip = (l: string) => l.replace(/^\[|\]$/g, "");
  const outStart = Math.max(0, opts.duration - fadeOut);
  return (
    `[${strip(opts.label)}]` +
    `afade=t=in:st=0:d=${fadeIn},` +
    `afade=t=out:st=${outStart.toFixed(2)}:d=${fadeOut}` +
    `[${strip(opts.outLabel)}]`
  );
}

export interface FinalAudioMixOptions {
  /**
   * Voice bus label, e.g. "[0:a]". Consumed twice BY DESIGN: once as the
   * sidechaincompress key (an inaudible control signal) and once as the
   * audible amix input — so the graph splits it explicitly with `asplit=2`
   * instead of relying on ffmpeg's implicit auto-split of multi-consumer
   * pads.
   */
  voiceLabel: string;
  /** Music bed label, e.g. "[music]". */
  musicLabel: string;
  /**
   * Full sidechaincompress params, e.g.
   * "threshold=0.02:ratio=8:attack=200:release=800:makeup=1".
   */
  duckParams: string;
  /** Output label, e.g. "[mix]". */
  outLabel: string;
  /** Extra amix options, e.g. "duration=first". */
  amixOptions?: string;
  /** Append `,alimiter=limit=0.95` after the mix (browser path). Default false. */
  limiter?: boolean;
}

/**
 * Builds the complete music-under-voice final mix graph with an EXPLICIT
 * `asplit=2` on the voice bus.
 *
 * Finding (2026-09-28, Stream E): the narration/voice bus was fed twice in
 * both render paths — once into sidechaincompress as the ducking key and
 * once into amix as the audible track. That double consumption is CORRECT by
 * design (the sidechain key is a control signal, not audible audio), and
 * ffmpeg's filtergraph parser auto-inserts an asplit for multi-consumer pads
 * (worker itFfmpeg tests prove the graph parses and runs). The fragility was
 * that the split was IMPLICIT: a future graph reorder could silently change
 * which copy drives the compressor. This builder makes the split explicit and
 * unit-testable.
 *
 * Example: buildFinalAudioMix({ voiceLabel: "[0:a]", musicLabel: "[bed]",
 *   duckParams: "threshold=0.03:ratio=8:attack=25:release=400",
 *   outLabel: "[mix]", amixOptions: "duration=first", limiter: true })
 * → "[0:a]asplit=2[vkey][vmix];[bed][vkey]sidechaincompress=threshold=0.03:ratio=8:attack=25:release=400[ducked];[vmix][ducked]amix=inputs=2:duration=first,alimiter=limit=0.95[mix]"
 */
export function buildFinalAudioMix(opts: FinalAudioMixOptions): string {
  const strip = (l: string) => l.replace(/^\[|\]$/g, "");
  const v = strip(opts.voiceLabel);
  const m = strip(opts.musicLabel);
  const out = strip(opts.outLabel);
  const amixOpts = opts.amixOptions ? `:${opts.amixOptions}` : "";
  const tail = opts.limiter === true ? `,alimiter=limit=0.95` : "";
  return (
    `[${v}]asplit=2[vkey][vmix];` +
    `[${m}][vkey]sidechaincompress=${opts.duckParams}[ducked];` +
    `[vmix][ducked]amix=inputs=2${amixOpts}${tail}[${out}]`
  );
}
