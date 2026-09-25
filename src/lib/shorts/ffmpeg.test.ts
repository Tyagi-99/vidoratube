import { describe, expect, it } from "vitest";
import { buildShortCutArgs, escapeFilterPath } from "./ffmpeg";

describe("buildShortCutArgs", () => {
  const args = buildShortCutArgs({
    input: "/renders/long.mp4",
    start: 12.5,
    duration: 30,
    assPath: "/tmp/short-1.ass",
    output: "/renders/short-1.mp4",
  });

  it("seeks to the window and limits duration", () => {
    expect(args).toContain("-ss");
    expect(args[args.indexOf("-ss") + 1]).toBe("12.500");
    expect(args).toContain("-t");
    expect(args[args.indexOf("-t") + 1]).toBe("30.000");
  });

  it("cuts 9:16 from the source frame and normalizes to 1080x1920", () => {
    const vf = args[args.indexOf("-vf") + 1]!;
    expect(vf).toContain("crop=in_h*9/16:in_h");
    expect(vf).toContain("scale=1080:1920");
  });

  it("burns captions with the ass filter", () => {
    const vf = args[args.indexOf("-vf") + 1]!;
    expect(vf).toContain("ass=");
    expect(vf).toContain("short-1.ass");
  });

  it("encodes a streaming-ready MP4", () => {
    expect(args).toContain("libx264");
    expect(args).toContain("aac");
    expect(args).toContain("+faststart");
    expect(args[args.length - 1]).toBe("/renders/short-1.mp4");
  });
});

describe("escapeFilterPath", () => {
  it("escapes filtergraph-special characters in the subtitle path", () => {
    const escaped = escapeFilterPath("/tmp/my:short,1.ass");
    expect(escaped).toBe("/tmp/my\\:short\\,1.ass");
  });
});
