import { describe, expect, it } from "vitest";
import { canRenderFinal } from "@/lib/content/stages";
import { projectCreationMode } from "@/lib/mode2/settings";
import {
  computeKeepWindow,
  getAutomaticEditingProvider,
  planHeuristicEdit,
} from "./heuristic";

describe("Mode 3 heuristic keep-window", () => {
  it("centers a window when source is longer than target", () => {
    expect(computeKeepWindow(120, 60)).toEqual({ trimStart: 30, trimEnd: 90 });
  });

  it("uses full source when shorter than target", () => {
    expect(computeKeepWindow(40, 60)).toEqual({ trimStart: 0, trimEnd: 40 });
  });
});

describe("Mode 3 AutomaticEditingProvider contract", () => {
  it("exposes heuristic provider", () => {
    const p = getAutomaticEditingProvider();
    expect(p.id).toBe("vidora-heuristic-v1");
    const plan = planHeuristicEdit({
      sourceDurationSeconds: 100,
      targetDurationSeconds: 30,
      aspect: "16:9",
      burnCaptions: true,
      enableVoiceover: false,
      title: "Demo. Clip one. Clip two.",
    });
    expect(plan.providerId).toBe("vidora-heuristic-v1");
    expect(plan.trimStart).toBe(35);
    expect(plan.trimEnd).toBe(65);
    expect(plan.segments).toHaveLength(1);
    expect(plan.cues.length).toBeGreaterThan(0);
    expect(plan.stubs.silenceDetection).toBe(true);
    expect(plan.stubs.autoEditorBackend).toBe(true);
  });

  it("skips cues when captions disabled", () => {
    const plan = planHeuristicEdit({
      sourceDurationSeconds: 20,
      targetDurationSeconds: 15,
      aspect: "9:16",
      burnCaptions: false,
      enableVoiceover: true,
    });
    expect(plan.cues).toEqual([]);
  });
});

describe("Mode 3 rights + creation mode", () => {
  it("gates final render like Mode 2", () => {
    expect(canRenderFinal("owned").ok).toBe(true);
    expect(canRenderFinal("unknown").ok).toBe(false);
  });

  it("recognizes auto_edit creation mode", () => {
    expect(
      projectCreationMode({
        creation_mode: "auto_edit",
        settings: {},
      }),
    ).toBe("auto_edit");
    expect(
      projectCreationMode({
        settings: { creation_mode: "auto_edit" },
      }),
    ).toBe("auto_edit");
  });
});
