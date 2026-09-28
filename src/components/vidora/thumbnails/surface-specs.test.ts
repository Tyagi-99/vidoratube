/**
 * Phase 6 Stream E (P4) — surface preview spec tests.
 */
import { describe, expect, it } from "vitest";
import { SURFACE_SPECS, thumbHeightPx, titleClampChars } from "./surface-specs";

describe("surface specs", () => {
  it("covers the five key surfaces with unique ids", () => {
    const ids = SURFACE_SPECS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(["home", "search", "suggested", "mobile", "channel"]));
  });

  it("uses real display widths (smallest = suggested sidebar)", () => {
    const widths = SURFACE_SPECS.map((s) => s.thumbWidthPx);
    expect(Math.min(...widths)).toBe(168);
    expect(widths.every((w) => w > 0)).toBe(true);
  });

  it("keeps 16:9 aspect on every slot", () => {
    for (const s of SURFACE_SPECS) {
      const h = thumbHeightPx(s.thumbWidthPx);
      expect(h / s.thumbWidthPx).toBeCloseTo(9 / 16, 2);
    }
    expect(thumbHeightPx(360)).toBe(203);
  });

  it("clamps titles shorter on narrower surfaces", () => {
    expect(titleClampChars(168, 2)).toBeLessThan(titleClampChars(390, 2));
    expect(titleClampChars(168, 2)).toBeGreaterThanOrEqual(12);
  });
});
