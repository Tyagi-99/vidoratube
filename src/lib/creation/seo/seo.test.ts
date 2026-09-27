import { describe, expect, it } from "vitest";
import {
  buildDescription,
  buildHashtags,
  buildSeoPackage,
  buildThumbnailConcepts,
  buildTitleOptions,
} from "./seo";

const input = {
  topic: "Why do airplane windows have a tiny hole?",
  title: "Why Do Airplane Windows Have a Tiny Hole?",
  facts: [
    "The tiny hole is a breather/bleed hole in the middle pane of the three-layer window.",
    "It equalizes pressure so the outer pane bears the full load; the middle pane stays a failsafe.",
  ],
  sourceUrls: ["https://gizmodo.com/why-is-there-a-hole-in-airplane-windows-1703660371"],
};

describe("buildTitleOptions", () => {
  it("reuses Stream A's deterministic generator and ranks by score", () => {
    const a = buildTitleOptions(input.topic, ["airplane", "window"], 6);
    const b = buildTitleOptions(input.topic, ["airplane", "window"], 6);
    expect(a).toEqual(b); // deterministic
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBeLessThanOrEqual(6);
    for (let i = 1; i < a.length; i++) {
      expect(a[i - 1]!.score.total).toBeGreaterThanOrEqual(a[i]!.score.total);
    }
    for (const t of a) {
      expect(t.score.total).toBeGreaterThanOrEqual(0);
      expect(t.score.total).toBeLessThanOrEqual(100);
    }
  });
});

describe("buildHashtags", () => {
  it("produces capped, #-prefixed, deduped tags", () => {
    const tags = buildHashtags(input.topic, input.title, 12);
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.length).toBeLessThanOrEqual(12);
    for (const t of tags) expect(t).toMatch(/^#[a-z0-9]+$/);
    expect(new Set(tags).size).toBe(tags.length);
  });
});

describe("buildDescription", () => {
  it("weaves title, facts, sources, brand sign-off, and hashtags", () => {
    const d = buildDescription(input, ["#airplane", "#shorts"]);
    expect(d).toContain(input.title);
    for (const f of input.facts) expect(d).toContain(f);
    expect(d).toContain(input.sourceUrls[0]);
    expect(d).toContain("#airplane #shorts");
  });

  it("omits the sources block when there are none (no fabrication)", () => {
    const d = buildDescription({ ...input, sourceUrls: [] }, []);
    expect(d).not.toContain("Sources:");
  });
});

describe("buildThumbnailConcepts", () => {
  it("returns exactly 3 concepts with short overlay text and honest rationales", () => {
    const concepts = buildThumbnailConcepts(input.topic, input.facts);
    expect(concepts).toHaveLength(3);
    for (const c of concepts) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.composition.length).toBeGreaterThan(0);
      expect(c.overlayText.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(4);
      // rationales explain design reasoning — never a CTR promise
      expect(c.rationale.toLowerCase()).not.toMatch(/ctr|click-through|guarantee|viral/);
    }
  });
});

describe("buildSeoPackage", () => {
  it("assembles the full package deterministically", () => {
    const a = buildSeoPackage(input);
    const b = buildSeoPackage(input);
    expect(a.description).toBe(b.description);
    expect(a.hashtags).toEqual(b.hashtags);
    expect(a.thumbnailConcepts).toEqual(b.thumbnailConcepts);
    expect(a.titleOptions.length).toBeGreaterThan(0);
    expect(a.chosenTitle).toBe(a.titleOptions[0]!.title);
    expect(typeof a.generatedAt).toBe("string");
  });
});
