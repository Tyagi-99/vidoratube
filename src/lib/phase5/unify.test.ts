import { describe, expect, it } from "vitest";
import type { CreationModeChoice } from "@/components/vidora/ModeChooser";
import { selectDownloadUrl, isFinalVideoReady } from "@/lib/jobs/final-video";
import { APPROVED_RIGHTS, canRenderFinal, isApprovedRights } from "@/lib/content/stages";
import { projectCreationMode } from "@/lib/mode2/settings";

const CHOOSER_MODES: CreationModeChoice[] = ["script", "voiceover", "auto_edit"];

describe("Phase 5 unify", () => {
  it("ModeChooser exposes all three creation modes", () => {
    expect(CHOOSER_MODES).toEqual(["script", "voiceover", "auto_edit"]);
  });

  it("download helper never returns audio", () => {
    expect(
      selectDownloadUrl({
        result_url: null,
      }),
    ).toBeNull();
    expect(selectDownloadUrl({ result_url: "https://cdn/v.mp4" })).toBe("https://cdn/v.mp4");
    expect(isFinalVideoReady({ status: "completed", result_url: null })).toBe(false);
  });

  it("owned is an approved rights basis", () => {
    expect(APPROVED_RIGHTS).toContain("owned");
    expect(isApprovedRights("owned")).toBe(true);
    expect(canRenderFinal("owned")).toEqual({ ok: true });
  });

  it("projectCreationMode resolves script / voiceover / auto_edit", () => {
    expect(projectCreationMode({ creation_mode: "script" })).toBe("script");
    expect(projectCreationMode({ creation_mode: "voiceover" })).toBe("voiceover");
    expect(projectCreationMode({ creation_mode: "auto_edit" })).toBe("auto_edit");
    expect(projectCreationMode({ settings: { creation_mode: "auto_edit" } })).toBe("auto_edit");
  });
});
