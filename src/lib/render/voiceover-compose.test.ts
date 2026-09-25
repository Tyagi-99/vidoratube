import { describe, expect, it } from "vitest";
import { adjustCuesForTrim } from "./voiceover-compose";
import type { RenderCue } from "./browser-render";

const cues: RenderCue[] = [
  { start: 0, end: 3, text: "intro" },
  { start: 4, end: 8, text: "middle" },
  { start: 10, end: 14, text: "late" },
];

describe("adjustCuesForTrim", () => {
  it("returns cues unchanged when there is no head trim", () => {
    expect(adjustCuesForTrim(cues, 0)).toEqual(cues);
    expect(adjustCuesForTrim(cues, -2)).toEqual(cues);
  });

  it("shifts every cue earlier by the trim amount", () => {
    const out = adjustCuesForTrim(cues, 2);
    expect(out.map((c) => [c.start, c.end])).toEqual([
      [0, 1],
      [2, 6],
      [8, 12],
    ]);
  });

  it("drops cues fully inside the trimmed region", () => {
    const out = adjustCuesForTrim(cues, 4);
    expect(out.map((c) => c.text)).toEqual(["middle", "late"]);
    expect(out[0]).toMatchObject({ start: 0, end: 4 });
  });

  it("clamps partially trimmed cues at zero", () => {
    const out = adjustCuesForTrim(cues, 1);
    expect(out[0]).toMatchObject({ start: 0, end: 2, text: "intro" });
  });

  it("returns an empty array when the trim covers everything", () => {
    expect(adjustCuesForTrim(cues, 20)).toEqual([]);
  });
});
