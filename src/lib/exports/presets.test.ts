import { describe, expect, it } from "vitest";
import {
  EXPORT_PRESETS,
  EXPORT_PRESET_IDS,
  defaultExportPresetForAspect,
  exportAudioEncodeArgs,
  exportEncodeArgs,
  exportPresetById,
  resolutionForExportPreset,
} from "./presets";

describe("export presets", () => {
  it("defines exactly the four platform presets", () => {
    expect([...EXPORT_PRESET_IDS].sort()).toEqual(
      ["instagram-reels", "tiktok", "youtube-longform", "youtube-shorts"].sort(),
    );
  });

  it("pins the correct native dimensions per platform", () => {
    expect(resolutionForExportPreset("youtube-longform")).toEqual({ width: 1920, height: 1080 });
    expect(resolutionForExportPreset("youtube-shorts")).toEqual({ width: 1080, height: 1920 });
    expect(resolutionForExportPreset("instagram-reels")).toEqual({ width: 1080, height: 1920 });
    expect(resolutionForExportPreset("tiktok")).toEqual({ width: 1080, height: 1920 });
  });

  it("specifies H.264 High, AAC 48kHz, +faststart on every preset", () => {
    for (const id of EXPORT_PRESET_IDS) {
      const p = EXPORT_PRESETS[id];
      expect(p.container).toBe("mp4");
      expect(p.videoCodec).toBe("libx264");
      expect(p.videoProfile).toBe("high");
      expect(p.pixelFormat).toBe("yuv420p");
      expect(p.audioCodec).toBe("aac");
      expect(p.audioSampleRate).toBe(48000);
      expect(p.audioChannels).toBe(2);
      expect(p.movflags).toBe("+faststart");
    }
  });

  it("emits the exact ffmpeg output args for youtube-longform @30fps", () => {
    expect(exportEncodeArgs(EXPORT_PRESETS["youtube-longform"], 30)).toEqual([
      "-c:v",
      "libx264",
      "-profile:v",
      "high",
      "-pix_fmt",
      "yuv420p",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-r",
      "30",
      "-g",
      "60",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-movflags",
      "+faststart",
    ]);
  });

  it("keeps -r/-g in sync with the render frame rate", () => {
    const args = exportEncodeArgs(EXPORT_PRESETS.tiktok, 24);
    const r = args.indexOf("-r");
    const g = args.indexOf("-g");
    expect(args[r + 1]).toBe("24");
    expect(args[g + 1]).toBe("48");
  });

  it("emits audio-only mux args with 48kHz for copy-video stages", () => {
    expect(exportAudioEncodeArgs(EXPORT_PRESETS["instagram-reels"])).toEqual([
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-ar",
      "48000",
      "-ac",
      "2",
    ]);
  });

  it("resolves presets by id and tolerates unknown ids", () => {
    expect(exportPresetById("tiktok")?.shortLabel).toBe("TikTok 9:16");
    expect(exportPresetById("nope")).toBeUndefined();
    expect(exportPresetById(null)).toBeUndefined();
    expect(exportPresetById(undefined)).toBeUndefined();
  });

  it("defaults 9:16 to Shorts and everything else to long-form", () => {
    expect(defaultExportPresetForAspect("9:16")).toBe("youtube-shorts");
    expect(defaultExportPresetForAspect("16:9")).toBe("youtube-longform");
    // 1:1 has no dedicated platform preset; long-form encode settings apply.
    expect(defaultExportPresetForAspect("1:1")).toBe("youtube-longform");
  });
});
