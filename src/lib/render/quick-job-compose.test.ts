import { describe, expect, it } from "vitest";
import {
  buildQuickJobScenes,
  buildSceneCaptionCues,
  isUsableCaption,
  resolveQuickJobCaptionTexts,
} from "./quick-job-compose";

describe("isUsableCaption", () => {
  it("rejects empty and Scene N placeholders", () => {
    expect(isUsableCaption("")).toBe(false);
    expect(isUsableCaption("   ")).toBe(false);
    expect(isUsableCaption("Scene 1")).toBe(false);
    expect(isUsableCaption("scene 3")).toBe(false);
  });

  it("accepts real caption text", () => {
    expect(isUsableCaption("The empire rose overnight")).toBe(true);
  });
});

describe("resolveQuickJobCaptionTexts", () => {
  it("keeps plan captions when all usable", () => {
    expect(
      resolveQuickJobCaptionTexts(["Alpha rising", "Beta falls"], 2, "ignored narration"),
    ).toEqual(["Alpha rising", "Beta falls"]);
  });

  it("fills gaps from narration timed across scenes", () => {
    const narration =
      "one two three four five six seven eight nine ten eleven twelve";
    const texts = resolveQuickJobCaptionTexts(["", "Scene 2"], 3, narration);
    expect(texts).toHaveLength(3);
    expect(texts.every((t) => isUsableCaption(t) || t.startsWith("Part"))).toBe(true);
    expect(texts[0]).toMatch(/one/);
    expect(texts.join(" ")).toContain("twelve");
  });

  it("does not invent empty cues when narration missing", () => {
    const texts = resolveQuickJobCaptionTexts([], 2, "");
    expect(texts).toEqual(["Part 1", "Part 2"]);
  });
});

describe("buildSceneCaptionCues / buildQuickJobScenes", () => {
  it("splits long captions into timed cues within scene duration", () => {
    const cues = buildSceneCaptionCues(
      "one two three four five six seven eight nine ten eleven twelve",
      10,
      4,
    );
    expect(cues.length).toBeGreaterThan(1);
    expect(cues[0]!.start).toBeGreaterThanOrEqual(0);
    expect(cues.at(-1)!.end).toBeLessThanOrEqual(10);
    expect(cues.every((c) => c.text.trim().length > 0)).toBe(true);
  });

  it("burns caption cues onto every scene when narration provided", () => {
    const scenes = buildQuickJobScenes(
      ["https://cdn/a.png", "https://cdn/b.png"],
      [],
      20,
      "The quick brown fox jumps over the lazy dog tonight",
    );
    expect(scenes).toHaveLength(2);
    expect(scenes.every((s) => s.cues.length > 0)).toBe(true);
    expect(scenes.every((s) => s.cues.every((c) => c.text.trim()))).toBe(true);
  });

  it("includes cues even when plan captions exist", () => {
    const scenes = buildQuickJobScenes(
      ["https://cdn/a.png"],
      ["Empire expands west"],
      8,
      null,
    );
    expect(scenes[0]!.cues[0]!.text).toContain("Empire");
  });
});
