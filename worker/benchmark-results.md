# Benchmark: 20-minute Story Mode render (one worker)

- Date: 2026-09-25T16:24:21.940Z
- Git: `b03dc6b`
- VM: 2 x AMD EPYC 9D25 126-Core Processor, 8 GB RAM
- Load average (1/5/15m) at start: 1.12 / 1.37 / 0.62; at end: 3.8 / 2.46 / 1.14 (mid-run ~4.2: the benchmark's own x264 encode plus an unattended apt update; a sibling vitest run had finished before launch, so no render contention at start)
- FFmpeg: ffmpeg version 8.1.2 Copyright (c) 2000-2026 the FFmpeg developers
- Node: v24.20.0
- Exact command: `npx tsx scripts/benchmark-20min.ts`
- Chapter implementation: RealChapterPipeline (worker/src/chapters.ts renderChapter + stitchChapters; synthetic paragraph audio over local HTTP)
- Settings: 2 measured chapters x 150s (5 scenes/chapter), 16:9@30fps, single-pass chapter encode (preset medium CRF 20, solid bg + subtitles burn)

## Methodology (summary - full version in scripts/benchmark-20min.ts header)

1. Drove worker/src/chapters.ts directly: 2 chapters x 150s, each with 5 synthetic paragraph WAVs (mock TTS) served over a local HTTP loopback server; real renderChapter (loopback download + paragraph audio concat to AAC 160k + word-cue ASS via spreadWordCues + a SINGLE x264 pass: solid-color background from the continuity brief + subtitles burn-in, preset medium CRF 20, +faststart).
2. Real stitchChapters (concat demuxer copy + faststart in one pass, no re-encode), plus a separately measured PROPOSED -14 LUFS loudnorm pass (not in chapters.ts; rate extrapolated linearly to 1200s). Chapter-mode renders have no music/ducking stage.
3. Projected 8 chapters x 150s = 1200s with benchmark-model.ts: total = ceil(8/C) * median(chapter wall) + stitch.

### Honest exclusions

- **Narration/TTS, LLM, image generation: NOT measured, NOT in totals.** Synthetic WAV/paragraph assets substituted (zero spend). Real TTS wall time is a separate pre-stage.
- Asset download/upload (Supabase): not measured; paragraph audio was served over loopback and its generation time is reported separately, labelled synthetic.
- Loudness stage: proposed only; shown both with and without.
- C=4 concurrency is hypothetical (this VM has 2 vCPUs); encode is CPU-bound.

## Measured (real FFmpeg, synthetic assets)

| Chapter | Media | Total | paragraph audio prep | chapter render (single pass) |
|---------|---------|---------|---------|---------|
| 0 | 150s | 59s | 0.9s (synthetic (mock TTS), local files) | 58.3s (real: loopback download + audio concat + solid-bg x264 with subtitles burn) |
| 1 | 150s | 1m 02s | 0.9s (synthetic (mock TTS), local files) | 60.7s (real: loopback download + audio concat + solid-bg x264 with subtitles burn) |

Stitch over 300s of chapter finals: concat+faststart 0.5s (single real stitchChapters pass), loudnorm 21.4s (proposed, rate 14.0x realtime).

## Projected: 20-minute Story Mode (1200s), target <= 15m 00s

| Chapter concurrency | With proposed loudnorm | Without loudnorm | Verdict |
|---------------------|------------------------|------------------|---------|
| C=1 | 9m 31s | 8m 06s | **HIT** |
| C=2 | 5m 29s | 4m 04s | **HIT** |
| C=4 (hypothetical, unmeasured) | 3m 28s | 2m 03s | **HIT** |

Projection detail (C=2, with proposed loudnorm): chapter phase 4m 02s (60s median chapter x 4 waves) + stitch 1m 27s (concat 1.8s + loudnorm 85.5s + finalize 0.0s).

## Bottleneck

(Filled from the measured numbers above: the single-pass x264 chapter render - solid background + subtitles burn over the full chapter duration - dominates; it is CPU-bound on this VM's vCPUs. Stitch is a cheap copy pass. Numbers, not adjectives, are in the tables.)
