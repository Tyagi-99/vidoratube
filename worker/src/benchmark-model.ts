/**
 * Pure projection model for the 20-minute Story Mode render benchmark.
 *
 * The benchmark harness (worker/scripts/benchmark-20min.ts) measures a small
 * number of chapters through the REAL FFmpeg pipeline (segment encode,
 * concat, audio mix with ducking, ASS caption burn-in, faststart finalize)
 * with synthetic inputs (no TTS/LLM/image spend), then uses this module to
 * project the full 20-minute wall time. The model is deliberately simple and
 * documented here so the investor report can quote the exact math:
 *
 *   perChapterSec   = median measured wall time of one chapter (150 s of media)
 *   chapterPhaseSec = ceil(targetChapters / chapterConcurrency) * perChapterSec
 *   stitchSec       = concatSec + loudnormSec + finalizeSec
 *     concatSec     = measured concat time scaled linearly by chapter count
 *     loudnormSec   = targetMediaSec / measuredLoudnormRate
 *                     (loudnorm is strictly linear in audio duration)
 *     finalizeSec   = measured faststart/mux time (treated as fixed)
 *   totalSec        = chapterPhaseSec + stitchSec
 *
 * Target: totalSec <= 900 s (15 minutes) for 20 minutes of Story Mode media.
 *
 * Honesty notes (also in the harness header + worker/benchmark-results.md):
 * - TTS / LLM / image-generation wall time is NOT measured and NOT in the
 *   total. It is a separate pre-stage in the real system; the sibling agent's
 *   design runs it ahead of / parallel to encoding.
 * - Asset "prep" (synthetic PNG/WAV generation) is measured but flagged as
 *   synthetic; real download/upload time is not included.
 * - The loudness stage (-14 LUFS) is PROPOSED, not in pipeline.ts as of this
 *   writing. Its cost is measured separately (single-pass loudnorm rate) and
 *   only folded into the total when includeLoudnorm=true, clearly labelled.
 */

export interface MeasuredChapter {
  /** 0-based chapter index */
  index: number;
  /** seconds of finished media in this chapter (e.g. 150) */
  mediaSec: number;
  /** measured wall seconds to render this chapter end-to-end */
  wallSec: number;
}

export interface MeasuredStitch {
  /** seconds of media in the stitched (multi-chapter) file that was measured */
  mediaSec: number;
  /** measured concat (demuxer copy) wall seconds for the measured chapter count */
  concatSec: number;
  /** number of chapters in the measured stitch */
  chapterCount: number;
  /** measured single-pass loudnorm wall seconds for the measured media */
  loudnormSec: number;
  /** measured faststart finalize wall seconds */
  finalizeSec: number;
}

export interface ProjectionInput {
  /** e.g. 1200 for the 20-minute investor target */
  targetMediaSec: number;
  /** e.g. 8 chapters of 150 s */
  targetChapters: number;
  /** chapter-level parallelism: 1 = current sequential code, 2 = chapter agent target */
  chapterConcurrency: number;
  measuredChapters: MeasuredChapter[];
  measuredStitch: MeasuredStitch;
  /** fold the proposed -14 LUFS loudness pass into the total */
  includeLoudnorm: boolean;
  /** pass mark, seconds (investor target: 900) */
  targetSec: number;
}

export interface Projection {
  perChapterSec: number;
  chapterPhaseSec: number;
  concatSec: number;
  loudnormSec: number;
  finalizeSec: number;
  stitchSec: number;
  totalSec: number;
  targetSec: number;
  hitsTarget: boolean;
}

export function median(values: number[]): number {
  if (values.length === 0) throw new Error("median of empty array");
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function projectTotal(input: ProjectionInput): Projection {
  const {
    targetMediaSec,
    targetChapters,
    chapterConcurrency,
    measuredChapters,
    measuredStitch,
    includeLoudnorm,
    targetSec,
  } = input;
  if (measuredChapters.length === 0) throw new Error("no measured chapters");
  if (!Number.isFinite(chapterConcurrency) || chapterConcurrency < 1)
    throw new Error("chapterConcurrency must be >= 1");
  if (targetChapters < 1) throw new Error("targetChapters must be >= 1");
  if (targetMediaSec <= 0) throw new Error("targetMediaSec must be > 0");

  const perChapterSec = median(measuredChapters.map((c) => c.wallSec));
  const chapterPhaseSec =
    Math.ceil(targetChapters / chapterConcurrency) * perChapterSec;

  // Concat (demuxer copy) scales ~linearly with chapter count / file size.
  const concatSec =
    measuredStitch.chapterCount > 0
      ? (measuredStitch.concatSec / measuredStitch.chapterCount) * targetChapters
      : 0;

  // Single-pass loudnorm is strictly linear in audio duration.
  const loudnormRate =
    measuredStitch.loudnormSec > 0
      ? measuredStitch.mediaSec / measuredStitch.loudnormSec
      : 0;
  const loudnormSec =
    includeLoudnorm && loudnormRate > 0 ? targetMediaSec / loudnormRate : 0;

  const finalizeSec = measuredStitch.finalizeSec;
  const stitchSec = concatSec + loudnormSec + finalizeSec;
  const totalSec = chapterPhaseSec + stitchSec;

  return {
    perChapterSec,
    chapterPhaseSec,
    concatSec,
    loudnormSec,
    finalizeSec,
    stitchSec,
    totalSec,
    targetSec,
    hitsTarget: totalSec <= targetSec,
  };
}

/** Human mm:ss / "12m 34s" formatting for reports. */
export function fmtDur(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}
