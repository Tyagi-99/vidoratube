import { describe, expect, it } from "vitest";
import { canRenderFinal, isApprovedRights } from "@/lib/content/stages";
import {
  resolveTargetDuration,
  scriptMatchesDuration,
  targetWordCount,
} from "@/lib/mode2/duration";
import { selectDownloadUrl } from "@/lib/jobs/final-video";
import { projectCreationMode, readMode2Settings } from "@/lib/mode2/settings";

describe("Mode 2 rights gate", () => {
  it("allows owned / licensed / granted / public_domain", () => {
    for (const s of ["owned", "licensed", "permission_granted", "public_domain"] as const) {
      expect(canRenderFinal(s)).toEqual({ ok: true });
      expect(isApprovedRights(s)).toBe(true);
    }
  });

  it("blocks unknown, do_not_use, permission_denied, requested", () => {
    expect(canRenderFinal("unknown").ok).toBe(false);
    expect(canRenderFinal("do_not_use").ok).toBe(false);
    expect(canRenderFinal("permission_denied").ok).toBe(false);
    expect(canRenderFinal("permission_requested").ok).toBe(false);
    expect(canRenderFinal("permission_required").ok).toBe(false);
  });
});

describe("Mode 2 duration targeting", () => {
  it("resolves presets", () => {
    expect(resolveTargetDuration(60)).toEqual({ ok: true, seconds: 60 });
    expect(resolveTargetDuration(15)).toEqual({ ok: true, seconds: 15 });
  });

  it("validates custom range", () => {
    expect(resolveTargetDuration("custom", 90)).toEqual({ ok: true, seconds: 90 });
    expect(resolveTargetDuration("custom", 2).ok).toBe(false);
    expect(resolveTargetDuration("custom", 900).ok).toBe(false);
  });

  it("estimates word count near 150 wpm", () => {
    expect(targetWordCount(60)).toBe(150);
    expect(targetWordCount(30)).toBe(75);
  });

  it("checks script length soft match", () => {
    const words = Array.from({ length: 150 }, () => "word").join(" ");
    expect(scriptMatchesDuration(words, 60).ok).toBe(true);
    expect(scriptMatchesDuration("too short", 60).ok).toBe(false);
  });
});

describe("Mode 2 download URL", () => {
  it("only returns result_url", () => {
    expect(selectDownloadUrl({ result_url: "https://cdn/final.mp4" })).toBe(
      "https://cdn/final.mp4",
    );
    expect(selectDownloadUrl({ result_url: null })).toBeNull();
  });
});

describe("Mode 2 settings helpers", () => {
  it("reads settings and creation mode", () => {
    expect(readMode2Settings(null)).toEqual({});
    expect(
      projectCreationMode({
        creation_mode: "voiceover",
        settings: {},
      }),
    ).toBe("voiceover");
    expect(
      projectCreationMode({
        settings: { creation_mode: "voiceover" },
      }),
    ).toBe("voiceover");
    expect(projectCreationMode({ settings: {} })).toBe("script");
  });
});
