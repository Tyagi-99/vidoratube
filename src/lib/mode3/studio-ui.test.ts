import { describe, expect, it } from "vitest";
import {
  AUTO_EDIT_CAPTION_STYLES,
  formatEditorClock,
  voiceoverFlags,
} from "./studio-ui";

describe("automatic-edit studio clock", () => {
  it("formats transport time like the AutoEditor preview", () => {
    expect(formatEditorClock(0)).toBe("0:00");
    expect(formatEditorClock(16)).toBe("0:16");
    expect(formatEditorClock(75.4)).toBe("1:15");
  });
});

describe("automatic-edit caption + voiceover controls", () => {
  it("exposes Highlight / Karaoke / Box", () => {
    expect(AUTO_EDIT_CAPTION_STYLES.map((s) => s.id)).toEqual(["highlight", "karaoke", "box"]);
    expect(AUTO_EDIT_CAPTION_STYLES.map((s) => s.label)).toEqual(["Highlight", "Karaoke", "Box"]);
  });

  it("maps Generate voiceover to enable_voiceover and mute original", () => {
    expect(voiceoverFlags("off")).toEqual({ enable_voiceover: false, mute_original: false });
    expect(voiceoverFlags("generate")).toEqual({ enable_voiceover: true, mute_original: true });
    expect(voiceoverFlags("upload")).toEqual({ enable_voiceover: false, mute_original: false });
  });
});
