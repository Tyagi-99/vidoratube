import { describe, expect, it } from "vitest";
import { ASPECT_ORIENTATION } from "./render.server";

describe("ASPECT_ORIENTATION", () => {
  it("covers every supported output aspect", () => {
    expect(ASPECT_ORIENTATION["16:9"]).toContain("16:9");
    expect(ASPECT_ORIENTATION["9:16"]).toContain("9:16");
    expect(ASPECT_ORIENTATION["1:1"]).toContain("1:1");
  });

  it("labels vertical and square distinctly from widescreen", () => {
    expect(ASPECT_ORIENTATION["9:16"]).toMatch(/vertical/i);
    expect(ASPECT_ORIENTATION["1:1"]).toMatch(/square/i);
    expect(ASPECT_ORIENTATION["16:9"]).toMatch(/widescreen/i);
  });
});
