import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { VOICE_CATALOG } from "./voices";
import { STYLES } from "../components/vidora/cinema/StyleGallery";
import {
  FEATURE_CATALOG,
  TOTAL_CATALOG_FEATURES,
} from "./feature-catalog";

/**
 * Marketing-claims guardrail (D316).
 *
 * Marketing numbers that exist in code must be derived from code, never
 * hardcoded: the hero stat strip and the feature catalog read the voice
 * catalog and the style gallery directly. This test pins the code truth
 * (16 built-in voices, 6 styles) and fails if a stale hardcoded claim
 * ("25+", "10 visual styles") ever reappears in Hero.tsx.
 */

const ROOT = resolve(process.cwd());
const BUILT_IN_VOICES = VOICE_CATALOG.filter((v) => !v.library).length;

/** Banned in catalog one-liners: guarantees, virality promises, income claims, fake social proof. */
const BANNED_CATALOG: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /guarantee[sd]? (you'll|you will|to) (earn|make money|get monetized|go viral)/i,
    reason: "income/virality guarantee",
  },
  { pattern: /will go viral/i, reason: "virality promise" },
  { pattern: /predicts? virality/i, reason: "virality prediction" },
  { pattern: /trusted by \d[\d,]*/i, reason: "fabricated social proof" },
  { pattern: /\$\d[\d,]*\s*(per|\/)\s*month/i, reason: "income claim" },
  { pattern: /100%\s*(monetiz|viral)/i, reason: "absolute claim" },
  { pattern: /#1 (ai|youtube)/i, reason: "unverifiable superlative" },
];

describe("marketing claims are derived from code", () => {
  it("pins the code truth: 16 built-in voices, 6 styles", () => {
    expect(BUILT_IN_VOICES).toBe(16);
    expect(STYLES.length).toBe(6);
  });

  it("Hero.tsx contains no stale hardcoded voice/style claims", () => {
    const hero = readFileSync(
      join(ROOT, "src", "components", "vidora", "cinema", "Hero.tsx"),
      "utf8",
    );
    expect(hero).not.toContain("25+");
    // Stale "10 styles" marketing claims, in any quoting style — but not
    // legitimate CSS values like border-white/10 or text-[10px].
    expect(hero).not.toMatch(/["'>]10["'<]/);
    expect(hero).not.toMatch(/\b10\+?\s*(visual\s+)?styles?/i);
    // Counts must come from the catalogs, not literals.
    expect(hero).toContain("VOICE_CATALOG");
    expect(hero).toContain("STYLES");
  });

  it("StyleGallery.tsx contains no stale hardcoded style count", () => {
    const gallery = readFileSync(
      join(ROOT, "src", "components", "vidora", "cinema", "StyleGallery.tsx"),
      "utf8",
    );
    expect(gallery).not.toContain("Ten ways");
    expect(gallery).not.toMatch(/\+ 4 more/);
  });
});

describe("feature catalog honesty", () => {
  it("has exactly the six pillars with valid anchor ids", () => {
    expect(FEATURE_CATALOG).toHaveLength(6);
    expect(FEATURE_CATALOG.map((p) => p.id)).toEqual([
      "discover",
      "validate",
      "create",
      "publish",
      "measure",
      "learn",
    ]);
    for (const pillar of FEATURE_CATALOG) {
      expect(pillar.id).toMatch(/^[a-z]+$/);
      expect(pillar.name.length).toBeGreaterThan(0);
      expect(pillar.tagline.length).toBeGreaterThan(0);
      expect(pillar.route.startsWith("/")).toBe(true);
    }
  });

  it("every feature has a real app route and an honest one-liner", () => {
    const violations: string[] = [];
    let count = 0;
    for (const pillar of FEATURE_CATALOG) {
      for (const feature of pillar.features) {
        count++;
        if (!feature.route.startsWith("/")) {
          violations.push(`${pillar.id}/${feature.name}: route "${feature.route}" must start with "/"`);
        }
        if (feature.description.trim().length < 20) {
          violations.push(`${pillar.id}/${feature.name}: description too short to be honest`);
        }
        for (const { pattern, reason } of BANNED_CATALOG) {
          if (pattern.test(feature.description)) {
            violations.push(
              `${pillar.id}/${feature.name}: /${pattern.source}/ — ${reason}`,
            );
          }
        }
      }
    }
    expect(count).toBeGreaterThan(40);
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("TOTAL_CATALOG_FEATURES matches the catalog", () => {
    const sum = FEATURE_CATALOG.reduce((s, p) => s + p.features.length, 0);
    expect(TOTAL_CATALOG_FEATURES).toBe(sum);
  });

  it("provider-gated features say which key they need", () => {
    const gated = FEATURE_CATALOG.flatMap((p) =>
      p.features.filter((f) => f.badge === "Needs a key"),
    );
    expect(gated.length).toBeGreaterThan(0);
    for (const feature of gated) {
      expect(feature.description.toLowerCase()).toMatch(/key/);
    }
  });

  it("not-built features are badged and say so in the sentence", () => {
    const unbuilt = FEATURE_CATALOG.flatMap((p) =>
      p.features.filter((f) => f.badge === "Shipping next" || f.badge === "Design only"),
    );
    expect(unbuilt.length).toBeGreaterThan(0);
    for (const feature of unbuilt) {
      expect(feature.description.toLowerCase()).toMatch(
        /shipping next|not built|not yet|once .* passes/,
      );
    }
  });
});
