import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { buildParallaxFilter, PARALLAX_DEFAULT_INTENSITY } from "./parallax";

describe("buildParallaxFilter", () => {
  it("builds a zoompan chain at the target size", () => {
    const f = buildParallaxFilter({ width: 1920, height: 1080, frames: 150 });
    expect(f).toContain("zoompan=");
    expect(f).toContain("s=1920x1080");
    expect(f).toContain("force_original_aspect_ratio=increase");
    expect(f).toContain("setsar=1");
    expect(f).toContain("d=1");
  });

  it("scales zoom amplitude with intensity (default 0.5 -> 0.05)", () => {
    const f = buildParallaxFilter({ width: 1280, height: 720, frames: 100 });
    // z='1+0.050000*(on/100)' — zoom travels 1 -> 1.05
    expect(f).toContain("z='1+0.050000*(on/100)'");
    // overscan K = 1 + 0.12*0.5 = 1.06
    expect(f).toContain("scale=iw*1.060:ih*1.060");
  });

  it("supports zoom-out direction", () => {
    const f = buildParallaxFilter({ width: 1280, height: 720, frames: 100, direction: "out" });
    expect(f).toContain("z='1.050000-0.050000*(on/100)'");
  });

  it("intensity 0 collapses to a static, still-valid chain", () => {
    const f = buildParallaxFilter({ width: 640, height: 360, frames: 30, intensity: 0 });
    expect(f).toContain("z='1+0.000000*(on/30)'");
    expect(f).toContain("scale=iw*1.000:ih*1.000");
    expect(f).toContain("zoompan=");
  });

  it("clamps intensity into 0..1", () => {
    const hi = buildParallaxFilter({ width: 640, height: 360, frames: 30, intensity: 5 });
    const one = buildParallaxFilter({ width: 640, height: 360, frames: 30, intensity: 1 });
    expect(hi).toBe(one);
    const lo = buildParallaxFilter({ width: 640, height: 360, frames: 30, intensity: -2 });
    const zero = buildParallaxFilter({ width: 640, height: 360, frames: 30, intensity: 0 });
    expect(lo).toBe(zero);
  });

  it("works for every supported aspect without changing shape", () => {
    for (const [w, h] of [
      [1920, 1080],
      [1080, 1920],
      [1080, 1080],
    ] as const) {
      const f = buildParallaxFilter({ width: w, height: h, frames: 60, intensity: 0.5 });
      expect(f).toContain(`s=${w}x${h}`);
      expect(f).toContain(`scale=${w}:${h}:force_original_aspect_ratio=increase`);
    }
  });

  it("pan stays a bounded fraction of the valid range", () => {
    const f = buildParallaxFilter({ width: 640, height: 360, frames: 60, intensity: 1 });
    // panX = 0.4, panY = 0.3 at intensity 1 — x/y never reach the input border
    expect(f).toContain("x='(iw-iw/zoom)/2+0.400000*(iw-iw/zoom)*((on/60)-0.5)'");
    expect(f).toContain("y='(ih-ih/zoom)/2-0.300000*(ih-ih/zoom)*((on/60)-0.5)'");
  });

  it("rejects non-positive dimensions", () => {
    expect(() => buildParallaxFilter({ width: 0, height: 1080, frames: 30 })).toThrow();
  });

  it("exposes the default subtle intensity", () => {
    expect(PARALLAX_DEFAULT_INTENSITY).toBe(0.5);
  });
});

describe("parallax filter (ffmpeg dry-run)", () => {
  const hasFfmpeg = (() => {
    try {
      execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();
  const itFfmpeg = hasFfmpeg ? it : it.skip;

  itFfmpeg("the generated chain is valid ffmpeg syntax and renders frames", () => {
    // Small frame + short clip keeps the dry-run fast.
    const filter = buildParallaxFilter({ width: 320, height: 180, frames: 30, intensity: 0.7 });
    const args = [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=640x360:duration=1:rate=30",
      "-vf",
      `${filter},fps=30`,
      "-frames:v",
      "30",
      "-f",
      "null",
      "-",
    ];
    // Throws on non-zero exit — i.e. the filter graph failed to parse/run.
    execFileSync("ffmpeg", args, { stdio: "pipe", timeout: 30000 });
  });

  itFfmpeg("zoom-out direction chain is valid too", () => {
    const filter = buildParallaxFilter({
      width: 320,
      height: 180,
      frames: 30,
      intensity: 1,
      direction: "out",
    });
    execFileSync(
      "ffmpeg",
      [
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=640x360:duration=1:rate=30",
        "-vf",
        `${filter},fps=30`,
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
