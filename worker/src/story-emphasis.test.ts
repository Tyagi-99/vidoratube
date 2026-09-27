/**
 * Story Mode worker tests (run with: npx tsx --test worker/src/*.test.ts).
 *
 * Covers the Story Mode treatment the pipeline applies: caption emphasis
 * (hook/payoff get the larger VidoraHook ASS style), the story duck profile,
 * and real FFmpeg dry-runs of the story music filtergraph and the
 * story-scaled parallax chain.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { buildWordAss } from "./pipeline.js";
import { buildParallaxFilter, PARALLAX_DEFAULT_INTENSITY } from "./parallax.js";
import {
  storyCaptionEmphasis,
  storyDuckParams,
  storyMusicSegments,
  storyMusicVolumeExpr,
  storyParallaxMultiplier,
} from "./story.js";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const itFfmpeg = hasFfmpeg ? it : it.skip;

describe("story caption emphasis (ASS)", () => {
  const cues = [
    { word: "Look", start: 0, end: 0.4, emphasis: true },
    { word: "at", start: 0.4, end: 0.6, emphasis: true },
    { word: "this", start: 0.6, end: 0.9, emphasis: true },
    { word: "now", start: 0.9, end: 1.2, emphasis: true },
    { word: "and", start: 5, end: 5.3 },
    { word: "then", start: 5.3, end: 5.6 },
    { word: "more", start: 5.6, end: 5.9 },
    { word: "context", start: 5.9, end: 6.3 },
  ];

  it("uses the VidoraHook style for emphasized groups, Vidora otherwise", () => {
    const ass = buildWordAss(cues, { fontSize: 64 });
    const lines = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    assert.equal(lines.length, 2);
    assert.match(lines[0]!, /,VidoraHook,/);
    assert.match(lines[1]!, /,Vidora,/);
  });

  it("defines VidoraHook at 1.25x the base font size", () => {
    const ass = buildWordAss(cues, { fontSize: 64 });
    assert.match(ass, /Style: VidoraHook,[^,]*,80,/);
    assert.match(ass, /Style: Vidora,[^,]*,64,/);
  });

  it("no emphasis anywhere keeps every line on the base style", () => {
    const plain = cues.map(({ emphasis: _e, ...c }) => c);
    const ass = buildWordAss(plain, { fontSize: 64 });
    assert.doesNotMatch(ass, /,VidoraHook,/);
  });
});

describe("story duck profile", () => {
  it("is deeper and faster than the standard profiles", () => {
    assert.equal(storyDuckParams(), "threshold=0.02:ratio=10:attack=20:release=600");
  });

  it("only hook and payoff beats request caption emphasis", () => {
    assert.equal(storyCaptionEmphasis("hook"), true);
    assert.equal(storyCaptionEmphasis("payoff"), true);
    assert.equal(storyCaptionEmphasis("setup"), false);
    assert.equal(storyCaptionEmphasis("rising_tension"), false);
    assert.equal(storyCaptionEmphasis("loop_cta"), false);
  });
});

describe("story music filtergraph (ffmpeg dry-run)", () => {
  itFfmpeg("volume envelope + story duck + amix parses and runs", () => {
    // Same topology the pipeline builds in assemble(): the bed follows the
    // per-beat envelope, ducks under the voice bus with the story profile,
    // then mixes with the voice.
    const segments = storyMusicSegments([4, 10, 6]);
    assert.ok(segments.length > 1, "expected several beat segments");
    const expr = storyMusicVolumeExpr(segments, 0.15);
    const fc =
      `[1:a]volume='${expr}':eval=frame,afade=t=in:st=0:d=1[music];` +
      `[music][0:a]sidechaincompress=${storyDuckParams()}:makeup=1[ducked];` +
      `[0:a][ducked]amix=inputs=2:normalize=0[aout]`;
    execFileSync(
      "ffmpeg",
      [
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=3",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=880:duration=3",
        "-filter_complex",
        fc,
        "-map",
        "[aout]",
        "-t",
        "3",
        "-f",
        "null",
        "-",
      ],
      { stdio: "pipe", timeout: 30000 },
    );
  });

  itFfmpeg("explicit asplit=2 voice split parses and runs (Stream E D99)", () => {
    // The pipeline's post-D99 topology: the voice bus is split EXPLICITLY —
    // one copy drives the sidechain key, the other is the audible mix input.
    const fc =
      `[0:a]asplit=2[vkey][vmix];` +
      `[1:a]volume=0.15,afade=t=in:st=0:d=1[music];` +
      `[music][vkey]sidechaincompress=${storyDuckParams()}:makeup=1[ducked];` +
      `[vmix][ducked]amix=inputs=2:normalize=0[aout]`;
    execFileSync(
      "ffmpeg",
      [
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=3",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=880:duration=3",
        "-filter_complex",
        fc,
        "-map",
        "[aout]",
        "-t",
        "3",
        "-f",
        "null",
        "-",
      ],
      { stdio: "pipe", timeout: 30000 },
    );
  });
});

describe("story-scaled parallax (ffmpeg dry-run)", () => {
  itFfmpeg("beat-scaled intensity chain renders frames", () => {
    const intensity = PARALLAX_DEFAULT_INTENSITY * storyParallaxMultiplier("rising_tension");
    assert.ok(intensity > 0 && intensity <= 1);
    const filter = buildParallaxFilter({
      width: 320,
      height: 180,
      frames: 30,
      intensity,
      direction: "in",
    });
    execFileSync(
      "ffmpeg",
      [
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=640x360:duration=1:rate=30",
        "-vf",
        `${filter},fps=30,format=yuv420p`,
        "-frames:v",
        "30",
        "-f",
        "null",
        "-",
      ],
      { stdio: "pipe", timeout: 30000 },
    );
  });
});
