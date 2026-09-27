import { describe, expect, it } from "vitest";
import {
  QUICK_CREATE_STAGE_KEYS,
  QUICK_CREATE_STAGE_SPECS,
  estimatePaidStageCredits,
  resolvePaidStage,
  resolveMusicStage,
  usdToCreditsEstimate,
} from "./pipeline";

describe("quick-create stage specs", () => {
  it("defines the 11-stage pipeline in order", () => {
    expect([...QUICK_CREATE_STAGE_KEYS]).toEqual([
      "idea",
      "research",
      "script",
      "scenes",
      "voiceover",
      "visuals",
      "assemble",
      "qc",
      "captions",
      "music",
      "render",
    ]);
    for (const key of QUICK_CREATE_STAGE_KEYS) {
      expect(QUICK_CREATE_STAGE_SPECS[key].key).toBe(key);
      expect(QUICK_CREATE_STAGE_SPECS[key].label.length).toBeGreaterThan(0);
    }
  });

  it("marks exactly voiceover/visuals/render as paid", () => {
    const paid = QUICK_CREATE_STAGE_KEYS.filter(
      (k) => QUICK_CREATE_STAGE_SPECS[k].costKind === "paid",
    );
    expect(paid).toEqual(["voiceover", "visuals", "render"]);
  });
});

describe("usdToCreditsEstimate", () => {
  it("converts USD to whole credits at the $0.245 reference rate", () => {
    expect(usdToCreditsEstimate(0.245)).toBe(1);
    expect(usdToCreditsEstimate(0.25)).toBe(2); // rounded up
    expect(usdToCreditsEstimate(null)).toBeNull();
    expect(usdToCreditsEstimate(-1)).toBeNull();
  });
});

describe("estimatePaidStageCredits", () => {
  it("estimates voiceover from narration characters (ESTIMATE basis)", () => {
    const credits = estimatePaidStageCredits("voiceover", { narrationText: "x".repeat(1000) });
    // 1000 chars × $0.00005 = $0.05 → ceil(0.05 / 0.245) = 1 credit
    expect(credits).toBe(1);
  });

  it("estimates visuals per scene and render per minute", () => {
    // 6 scenes × $0.03 = $0.18 → ceil(0.18/0.245) = 1
    expect(estimatePaidStageCredits("visuals", { sceneCount: 6 })).toBe(1);
    // 30s → 0.5 min × $0.25 = $0.125 → 1 credit
    expect(estimatePaidStageCredits("render", { totalSec: 30 })).toBe(1);
  });

  it("returns null (never invented) when the input is missing", () => {
    expect(estimatePaidStageCredits("voiceover", {})).toBeNull();
    expect(estimatePaidStageCredits("visuals", { sceneCount: 0 })).toBeNull();
    expect(estimatePaidStageCredits("idea", {})).toBeNull();
  });
});

describe("resolvePaidStage", () => {
  const base = { costEstimateCredits: 3, providerName: "TTS provider" };

  it("skips as unconfigured when no provider key exists", () => {
    const r = resolvePaidStage({ ...base, providerConfigured: false, spendApproved: false });
    expect(r.status).toBe("skipped_unconfigured");
    expect(r.detail).toContain("TTS provider");
  });

  it("skips as needs_spend_approval with the ESTIMATE when key exists but no approval", () => {
    const r = resolvePaidStage({ ...base, providerConfigured: true, spendApproved: false });
    expect(r.status).toBe("skipped_needs_spend_approval");
    expect(r.detail).toContain("ESTIMATE");
    expect(r.detail).toContain("3 credit");
  });

  it("never reports done — the caller must run the real call", () => {
    const r = resolvePaidStage({ ...base, providerConfigured: true, spendApproved: true });
    expect(r.status).toBe("running");
    expect(r.status).not.toBe("done");
  });
});

describe("resolveMusicStage", () => {
  it("is done only with a real attached track", () => {
    const r = resolveMusicStage("https://example.com/track.mp3");
    expect(r.status).toBe("done");
    expect(r.detail).toContain("ducked");
  });

  it("is honestly skipped_unconfigured without a music source", () => {
    const r = resolveMusicStage(null);
    expect(r.status).toBe("skipped_unconfigured");
    expect(r.detail).toContain("BYO");
  });
});
