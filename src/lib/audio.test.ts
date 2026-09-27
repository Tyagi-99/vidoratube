import { describe, expect, it } from "vitest";
import { buildDuckingFilter, buildFinalAudioMix, buildMusicFade } from "./audio";

describe("audio ducking", () => {
  it("builds a valid sidechaincompress filter", () => {
    const f = buildDuckingFilter({
      musicLabel: "[music]",
      voiceLabel: "[voice]",
      outLabel: "[ducked]",
    });
    expect(f).toBe(
      "[music][voice]sidechaincompress=threshold=0.02:ratio=8:attack=200:release=800:makeup=1[ducked]",
    );
  });

  it("accepts labels without brackets", () => {
    const f = buildDuckingFilter({ musicLabel: "m", voiceLabel: "v", outLabel: "d" });
    expect(f).toBe(
      "[m][v]sidechaincompress=threshold=0.02:ratio=8:attack=200:release=800:makeup=1[d]",
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
    expect(f).toBe("[music]afade=t=in:st=0:d=1,afade=t=out:st=58.00:d=2[mf]");
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

describe("final audio mix (Stream E asplit fix)", () => {
  const MIX = buildFinalAudioMix({
    voiceLabel: "[0:a]",
    musicLabel: "[bed]",
    duckParams: "threshold=0.03:ratio=8:attack=25:release=400",
    outLabel: "[mix]",
    amixOptions: "duration=first:normalize=0",
    limiter: true,
  });

  it("splits the voice bus explicitly with asplit=2", () => {
    expect(MIX).toContain("[0:a]asplit=2[vkey][vmix]");
  });

  it("drives the sidechain from the split key copy, not the raw voice bus", () => {
    // The raw [0:a] label must appear exactly once as a filter INPUT source
    // (into asplit). Both downstream consumers use the split copies.
    const sources = MIX.match(/\[0:a\]/g) ?? [];
    expect(sources).toHaveLength(1);
    expect(MIX).toContain("[bed][vkey]sidechaincompress=");
  });

  it("mixes the audible voice copy with the ducked bed exactly once", () => {
    expect(MIX).toContain(
      "[vmix][ducked]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[mix]",
    );
    // No second amix, no second audible voice feed.
    expect(MIX.match(/amix=/g)).toHaveLength(1);
  });

  it("builds the exact browser-render graph (byte-identical topology)", () => {
    expect(MIX).toBe(
      "[0:a]asplit=2[vkey][vmix];" +
        "[bed][vkey]sidechaincompress=threshold=0.03:ratio=8:attack=25:release=400[ducked];" +
        "[vmix][ducked]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[mix]",
    );
  });

  it("omits optional amix options and the limiter when unset", () => {
    const f = buildFinalAudioMix({
      voiceLabel: "[voice]",
      musicLabel: "[music]",
      duckParams: "threshold=0.02:ratio=8:attack=200:release=800:makeup=1",
      outLabel: "[aout]",
    });
    expect(f).toBe(
      "[voice]asplit=2[vkey][vmix];" +
        "[music][vkey]sidechaincompress=threshold=0.02:ratio=8:attack=200:release=800:makeup=1[ducked];" +
        "[vmix][ducked]amix=inputs=2[aout]",
    );
  });
});
