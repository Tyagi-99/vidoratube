import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Marketing-honesty guardrail: scans every .tsx source file for banned
 * phrases — fake guarantees, fabricated social proof, and income claims.
 * Add new banned patterns here as the marketing surface grows.
 */

const SRC = resolve(process.cwd(), "src");

const BANNED: { pattern: RegExp; reason: string }[] = [
  { pattern: /guaranteed monetiz/i, reason: "monetization can never be guaranteed (YouTube decides)" },
  { pattern: /guarantee[sd]? (you'll|you will|to) (earn|make money|get monetized)/i, reason: "income/monetization guarantee" },
  { pattern: /100%\s*monetiz/i, reason: "absolute monetization claim" },
  { pattern: /trusted by \d[\d,]*( creators| users| youtubers)/i, reason: "fabricated user count" },
  { pattern: /join (thousands|millions) of/i, reason: "fabricated social proof" },
  { pattern: /\$\d[\d,]*\s*(per|\/)\s*month/i, reason: "income claim (allowed only in real user testimonials with attribution)" },
  { pattern: /#1 (ai|youtube)/i, reason: "unverifiable superlative" },
  { pattern: /best ai video/i, reason: "unverifiable superlative" },
];

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (f === "node_modules") continue;
      out.push(...tsxFiles(p));
    } else if (f.endsWith(".tsx") && !f.endsWith(".test.tsx")) {
      out.push(p);
    }
  }
  return out;
}

describe("marketing copy honesty scan", () => {
  it("contains no banned claims in UI copy", () => {
    const violations: string[] = [];
    for (const file of tsxFiles(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const { pattern, reason } of BANNED) {
        if (pattern.test(text)) {
          violations.push(`${file}: /${pattern.source}/ — ${reason}`);
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("safety disclaimers never promise guaranteed monetization", () => {
    const safety = readFileSync(join(SRC, "lib", "safety.ts"), "utf8");
    expect(safety.toLowerCase()).toContain("not a guarantee");
  });
});
