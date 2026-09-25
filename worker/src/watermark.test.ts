/**
 * Worker unit tests (run with: npx tsx --test src/*.test.ts).
 * Covers: watermark ASS generation, brand filter-chain planning.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildWatermarkAss, planBrandFilters } from "./watermark.js";

describe("buildWatermarkAss", () => {
  it("burns a full-duration bottom-right bug", () => {
    const ass = buildWatermarkAss(90);
    assert.ok(ass.includes("Style: Bug,Inter,36"));
    // Alignment 3 = bottom-right, full duration end time.
    assert.match(ass, /,3,40,40,36,1/);
    assert.ok(ass.includes("Dialogue: 0,0:00:00.00,0:01:30.00,Bug,,0,0,0,,Vidora"));
  });

  it("uses the brand primary color (converted to ASS &HAABBGGRR)", () => {
    // #F59E0B -> &H990B9EF5 (0x99 alpha + BBG GGRR)
    const ass = buildWatermarkAss(10, { primaryColor: "#F59E0B" });
    assert.ok(ass.includes("&H990B9EF5"));
  });

  it("falls back to white for invalid colors and strips ASS braces", () => {
    const ass = buildWatermarkAss(10, { primaryColor: "red", label: "Vid{ora}" });
    assert.ok(ass.includes("&H99FFFFFF"));
    assert.ok(!ass.includes("{ora}"));
  });

  it("clamps non-positive durations to 1 second", () => {
    const ass = buildWatermarkAss(0);
    assert.ok(ass.includes("0:00:01.00,Bug"));
  });
});

describe("planBrandFilters", () => {
  it("returns null when there is no logo and no watermark (free fast path)", () => {
    assert.equal(planBrandFilters({ logoPath: null, watermark: false, assPath: null }), null);
  });

  it("plans a watermark-only chain", () => {
    const plan = planBrandFilters({ logoPath: null, watermark: true, assPath: "/tmp/wm.ass" });
    assert.ok(plan !== null);
    assert.deepEqual(plan.extraInputs, []);
    assert.deepEqual(plan.filterParts, ["[0:v]ass=/tmp/wm.ass[vbrand]"]);
    assert.equal(plan.hasLogo, false);
  });

  it("plans a logo-only chain", () => {
    const plan = planBrandFilters({ logoPath: "/tmp/logo.png", watermark: false, assPath: null });
    assert.ok(plan !== null);
    assert.deepEqual(plan.extraInputs, ["/tmp/logo.png"]);
    assert.deepEqual(plan.filterParts, [
      "[1:v]scale=-2:120[logo]",
      "[0:v][logo]overlay=40:H-h-40[vlogo]",
      "[vlogo]null[vbrand]",
    ]);
    assert.equal(plan.hasLogo, true);
  });

  it("plans logo + watermark together, logo bottom-left and bug bottom-right", () => {
    const plan = planBrandFilters({ logoPath: "/tmp/logo.png", watermark: true, assPath: "/tmp/wm.ass" });
    assert.ok(plan !== null);
    assert.deepEqual(plan.filterParts, [
      "[1:v]scale=-2:120[logo]",
      "[0:v][logo]overlay=40:H-h-40[vlogo]",
      "[vlogo]ass=/tmp/wm.ass[vbrand]",
    ]);
  });

  it("escapes single quotes in the ASS path", () => {
    const plan = planBrandFilters({ logoPath: null, watermark: true, assPath: "/tmp/it's.ass" });
    assert.ok(plan !== null);
    assert.ok(plan.filterParts[0]!.includes("ass=/tmp/it'\\''s.ass[vbrand]"));
  });

  it("throws when watermark is requested without an ASS path", () => {
    assert.throws(() => planBrandFilters({ logoPath: null, watermark: true, assPath: null }));
  });
});
