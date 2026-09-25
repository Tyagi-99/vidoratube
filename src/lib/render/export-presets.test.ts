import { describe, expect, it } from "vitest";
import { presetFor, resolutionFor, resolutionForRender } from "./browser-render";

describe("export preset wiring", () => {
  it("falls back to aspect-derived resolution without a preset", () => {
    expect(resolutionForRender({ aspect: "16:9" })).toEqual({
      width: 1920,
      height: 1080,
      preset: undefined,
    });
    expect(resolutionForRender({ aspect: "9:16" })).toEqual({
      width: 1080,
      height: 1920,
      preset: undefined,
    });
    expect(resolutionForRender({ aspect: "1:1" })).toEqual({
      width: 1080,
      height: 1080,
      preset: undefined,
    });
  });

  it("lets the preset fully determine the output frame", () => {
    const r = resolutionForRender({ aspect: "16:9", exportPreset: "youtube-shorts" });
    expect(r.width).toBe(1080);
    expect(r.height).toBe(1920);
    expect(r.preset?.id).toBe("youtube-shorts");
  });

  it("treats an unknown preset id as no preset (legacy path)", () => {
    expect(resolutionForRender({ aspect: "16:9", exportPreset: "nope" })).toEqual({
      width: 1920,
      height: 1080,
      preset: undefined,
    });
    expect(presetFor({ exportPreset: "nope" })).toBeUndefined();
  });

  it("resolutionFor keeps its legacy aspect mapping", () => {
    expect(resolutionFor("16:9")).toEqual({ width: 1920, height: 1080 });
    expect(resolutionFor("9:16")).toEqual({ width: 1080, height: 1920 });
    expect(resolutionFor("whatever")).toEqual({ width: 1920, height: 1080 });
  });
});
