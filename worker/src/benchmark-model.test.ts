/**
 * Unit tests for the benchmark projection model (pure math, no FFmpeg).
 * Run with: npx tsx --test src/benchmark-model.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fmtDur, median, projectTotal } from "./benchmark-model.js";
import type { MeasuredStitch, ProjectionInput } from "./benchmark-model.js";

const STITCH: MeasuredStitch = {
  mediaSec: 300,
  concatSec: 2,
  chapterCount: 2,
  loudnormSec: 15,
  finalizeSec: 3,
};

function input(over: Partial<ProjectionInput> = {}): ProjectionInput {
  return {
    targetMediaSec: 1200,
    targetChapters: 8,
    chapterConcurrency: 1,
    measuredChapters: [
      { index: 0, mediaSec: 150, wallSec: 300 },
      { index: 1, mediaSec: 150, wallSec: 320 },
    ],
    measuredStitch: STITCH,
    includeLoudnorm: true,
    targetSec: 900,
    ...over,
  };
}

describe("median", () => {
  it("odd count takes the middle", () => assert.equal(median([3, 1, 2]), 2));
  it("even count averages the middle two", () => assert.equal(median([4, 1, 3, 2]), 2.5));
  it("throws on empty", () => assert.throws(() => median([])));
});

describe("projectTotal", () => {
  it("sequential projection: 8 chapters x median(300,320)=310", () => {
    const p = projectTotal(input());
    assert.equal(p.perChapterSec, 310);
    assert.equal(p.chapterPhaseSec, 8 * 310);
    // concat: 2s/2ch * 8 = 8s; loudnorm rate 300/15=20x -> 1200/20=60s; finalize 3s
    assert.equal(p.concatSec, 8);
    assert.equal(p.loudnormSec, 60);
    assert.equal(p.finalizeSec, 3);
    assert.equal(p.stitchSec, 71);
    assert.equal(p.totalSec, 2480 + 71);
    assert.equal(p.hitsTarget, false);
  });

  it("concurrency 2 halves the chapter phase (ceil)", () => {
    const p = projectTotal(input({ chapterConcurrency: 2 }));
    assert.equal(p.chapterPhaseSec, 4 * 310);
    assert.equal(p.totalSec, 1240 + 71);
  });

  it("odd chapter counts round up: 7 chapters at C=2 -> 4 waves", () => {
    const p = projectTotal(input({ targetChapters: 7, chapterConcurrency: 2 }));
    assert.equal(p.chapterPhaseSec, 4 * 310);
    assert.equal(p.concatSec, 7);
  });

  it("includeLoudnorm=false drops the loudness stage", () => {
    const p = projectTotal(input({ includeLoudnorm: false }));
    assert.equal(p.loudnormSec, 0);
    assert.equal(p.stitchSec, 11);
  });

  it("hitsTarget is true when total <= targetSec", () => {
    const fast = input({
      measuredChapters: [{ index: 0, mediaSec: 150, wallSec: 60 }],
      chapterConcurrency: 8,
      includeLoudnorm: false,
    });
    const p = projectTotal(fast);
    assert.equal(p.totalSec, 60 + 8 + 3);
    assert.equal(p.hitsTarget, true);
  });

  it("boundary: total exactly equal to target counts as hit", () => {
    const p = projectTotal(
      input({
        measuredChapters: [{ index: 0, mediaSec: 150, wallSec: 100 }],
        chapterConcurrency: 8,
        includeLoudnorm: false,
        targetSec: 100 + 8 + 3,
      }),
    );
    assert.equal(p.hitsTarget, true);
  });

  it("throws on no measured chapters", () => {
    assert.throws(() => projectTotal(input({ measuredChapters: [] })));
  });

  it("throws on invalid concurrency / targets", () => {
    assert.throws(() => projectTotal(input({ chapterConcurrency: 0 })));
    assert.throws(() => projectTotal(input({ targetChapters: 0 })));
    assert.throws(() => projectTotal(input({ targetMediaSec: 0 })));
  });

  it("zero measured loudnorm time -> loudnormSec 0, no crash", () => {
    const p = projectTotal(
      input({ measuredStitch: { ...STITCH, loudnormSec: 0 } }),
    );
    assert.equal(p.loudnormSec, 0);
  });
});

describe("fmtDur", () => {
  it("formats seconds and minutes", () => {
    assert.equal(fmtDur(45), "45s");
    assert.equal(fmtDur(754), "12m 34s");
    assert.equal(fmtDur(60), "1m 00s");
  });
});
