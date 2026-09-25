import { describe, expect, it } from "vitest";
import { buildDuckingFilter, buildMusicFade } from "./audio";

describe("audio ducking", () => {
  it("builds a valid sidechaincompress filter", () => {
    const f = buildDuckingFilter({
      musicLabel: "[music]",
      voiceLabel: "[voice]",
      outLabel: "[ducked]",
    });
    expect(f).toBe(
      "[music][voice]sidechaincompress=threshold=0.02:ratio=8:attack=200:release=800:makeup=1[ducked]"
    );
  });

  it("accepts labels without brackets", () => {
    const f = buildDuckingFilter({ musicLabel: "m", voiceLabel: "v", outLabel: "d" });
    expect(f).toBe(
      "[m][v]sidechaincompress=threshold=0.02:ratio=8:attack=200:release=800:makeup=1[d]"
    );
  });

  it("scales ratio with dip depth and honours attack/release", () => {
    const f = buildDuckingFilter({
      musicLabel: "[music]",
      voiceLabel: "[voice]",
      outLabel: "[ducked]",
      dipDb: 20,
      attackMs: 100,
      releaseMs: 500,
    });
    expect(f).toContain("ratio=14");
    expect(f).toContain("attack=100");
    expect(f).toContain("release=500");
  });

  it("clamps ratio to a sane range", () => {
    const low = buildDuckingFilter({
      musicLabel: "[m]",
      voiceLabel: "[v]",
      outLabel: "[d]",
      dipDb: 1,
    });
    expect(low).toContain("ratio=2");
    const high = buildDuckingFilter({
      musicLabel: "[m]",
      voiceLabel: "[v]",
      outLabel: "[d]",
      dipDb: 60,
    });
    expect(high).toContain("ratio=20");
  });
});

describe("music fade", () => {
  it("builds afade in/out for a known duration", () => {
    const f = buildMusicFade({ label: "[music]", outLabel: "[mf]", duration: 60 });
    expect(f).toBe(
      "[music]afade=t=in:st=0:d=1,afade=t=out:st=58.00:d=2[mf]"
    );
  });

  it("never starts the fade-out before zero", () => {
    const f = buildMusicFade({
      label: "[m]",
      outLabel: "[o]",
      duration: 1,
      fadeOut: 5,
    });
    expect(f).toContain("st=0.00");
  });
});
