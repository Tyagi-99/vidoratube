import { describe, expect, it } from "vitest";
import {
  isFinalVideoReady,
  looksLikeMp4,
  needsClientCompose,
  nextStageAfterVisuals,
  selectDownloadUrl,
  validateClientFinalizeMeta,
} from "./final-video";

describe("selectDownloadUrl", () => {
  it("returns result_url only", () => {
    expect(selectDownloadUrl({ result_url: "https://cdn/video.mp4" })).toBe(
      "https://cdn/video.mp4",
    );
  });

  it("never falls back to audio_url", () => {
    expect(
      selectDownloadUrl({
        result_url: null,
      }),
    ).toBeNull();
  });
});

describe("isFinalVideoReady", () => {
  it("requires completed + result_url", () => {
    expect(isFinalVideoReady({ status: "completed", result_url: "https://x/v.mp4" })).toBe(true);
    expect(isFinalVideoReady({ status: "completed", result_url: null })).toBe(false);
    expect(isFinalVideoReady({ status: "running", result_url: "https://x/v.mp4" })).toBe(false);
  });
});

describe("needsClientCompose / stage transitions", () => {
  const base = {
    status: "running",
    audio_url: "https://cdn/narration.mp3",
    assets: ["https://cdn/scene-0.png"],
    result_url: null as string | null,
  };

  it("client_render with assets+audio needs compose", () => {
    expect(needsClientCompose({ ...base, stage: "client_render" })).toBe(true);
  });

  it("legacy preview stage also needs compose (not completed video)", () => {
    expect(needsClientCompose({ ...base, stage: "preview" })).toBe(true);
  });

  it("preview is not treated as a finished final video", () => {
    expect(isFinalVideoReady({ status: "completed", result_url: null })).toBe(false);
    expect(needsClientCompose({ ...base, stage: "preview", status: "running" })).toBe(true);
  });

  it("does not compose when result_url already set", () => {
    expect(
      needsClientCompose({
        ...base,
        stage: "client_render",
        result_url: "https://cdn/video.mp4",
      }),
    ).toBe(false);
  });

  it("does not compose during shotstack render stages", () => {
    expect(needsClientCompose({ ...base, stage: "render" })).toBe(false);
    expect(needsClientCompose({ ...base, stage: "rendering" })).toBe(false);
  });

  it("nextStageAfterVisuals skips preview-as-done", () => {
    expect(nextStageAfterVisuals(false)).toEqual({
      stage: "client_render",
      progress: 72,
      step: "Composing the cut",
    });
    expect(nextStageAfterVisuals(true).stage).toBe("render");
  });
});

describe("validation helpers", () => {
  it("looksLikeMp4 detects ftyp", () => {
    const buf = new Uint8Array(32);
    buf[4] = 0x66;
    buf[5] = 0x74;
    buf[6] = 0x79;
    buf[7] = 0x70;
    expect(looksLikeMp4(buf)).toBe(true);
    expect(looksLikeMp4(new Uint8Array(32))).toBe(false);
  });

  it("validateClientFinalizeMeta rejects empty or zero-duration", () => {
    expect(validateClientFinalizeMeta({ file_size: 100, duration: 10 })).toMatch(/too small/);
    expect(validateClientFinalizeMeta({ file_size: 5000, duration: 0 })).toMatch(/duration/);
    expect(validateClientFinalizeMeta({ file_size: 5000, duration: 12.5 })).toBeNull();
  });
});
