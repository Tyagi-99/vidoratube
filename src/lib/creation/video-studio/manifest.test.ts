import { describe, expect, it } from "vitest";
import { buildSceneManifest, estimateSceneDurationSec, mapSceneStatus } from "./manifest";

describe("estimateSceneDurationSec", () => {
  it("estimates 150 WPM narration timing", () => {
    // 30 words → 12s at 150 WPM + 0.5s pad (matches browser renderer)
    const narration = Array(30).fill("word").join(" ");
    expect(estimateSceneDurationSec(narration, null)).toBeCloseTo(12.5, 1);
  });

  it("prefers an explicit duration override", () => {
    expect(estimateSceneDurationSec("short", 9.5)).toBe(9.5);
  });

  it("enforces a floor and ceiling", () => {
    expect(estimateSceneDurationSec("", null)).toBeGreaterThanOrEqual(1);
    expect(estimateSceneDurationSec(Array(3000).fill("word").join(" "), null)).toBeLessThanOrEqual(
      600,
    );
  });
});

describe("mapSceneStatus", () => {
  it("maps scene statuses to the pinned manifest vocabulary", () => {
    // Pinned: draft | assets_ready | narration_ready | rendered | failed.
    // Anything else ("done", "rendering", …) degrades to draft.
    expect(mapSceneStatus("assets_ready")).toBe("assets_ready");
    expect(mapSceneStatus("narration_ready")).toBe("narration_ready");
    expect(mapSceneStatus("rendered")).toBe("rendered");
    expect(mapSceneStatus("failed")).toBe("failed");
    expect(mapSceneStatus("done")).toBe("draft");
    expect(mapSceneStatus("rendering")).toBe("draft");
    expect(mapSceneStatus("anything_else")).toBe("draft");
    expect(mapSceneStatus("")).toBe("draft");
    expect(mapSceneStatus(null)).toBe("draft");
  });
});

describe("buildSceneManifest", () => {
  const scenes = [
    {
      sceneId: "11111111-1111-1111-1111-111111111111",
      sceneNumber: 1,
      narration: "Hello world.",
      visualPrompt: "A sunrise",
      assetUrl: "https://example.com/a.png",
      assetSource: {},
      durationSec: 4,
      status: "assets_ready",
      checkpoint: null,
    },
    {
      sceneId: "22222222-2222-2222-2222-222222222222",
      sceneNumber: 2,
      narration: "Second scene.",
      visualPrompt: null,
      assetUrl: null,
      assetSource: {},
      durationSec: 3,
      status: "draft",
      checkpoint: { state: "done" as const },
    },
  ];

  it("produces the pinned SceneManifest shape", () => {
    const manifest = buildSceneManifest("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", null, scenes);
    // Pinned contract: { projectId, renderId, scenes } — no extra fields.
    expect(Object.keys(manifest).sort()).toEqual(["projectId", "renderId", "scenes"]);
    expect(manifest.projectId).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    expect(manifest.renderId).toBeNull();
    expect(manifest.scenes).toHaveLength(2);
    expect(manifest.scenes[0]!.sceneNumber).toBe(1);
    expect(manifest.scenes[0]!.status).toBe("assets_ready");
    expect(manifest.scenes[0]!.durationSecEstimate).toBeGreaterThan(0);
    expect(manifest.scenes[1]!.status).toBe("draft");
    expect(manifest.scenes[1]!.checkpoint?.["state"]).toBe("done");
  });

  it("passes through an optional renderId", () => {
    const manifest = buildSceneManifest(
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      [],
    );
    expect(manifest.renderId).toBe("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
  });
});
