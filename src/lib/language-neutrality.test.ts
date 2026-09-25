import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Language-neutrality guardrail.
 *
 * Vidora is language-neutral: language behaviour (fonts, RTL, caption rules,
 * voices, LLM instructions) comes ONLY from the `languages` table.
 * No component or lib module may branch on a hardcoded language name or code.
 *
 * Allowed: the voice catalog data file (src/lib/voices.ts), i18n files,
 * migrations, marketing copy that merely names a language in prose, and tests.
 */
const SRC = dirname(fileURLToPath(import.meta.url)); // src/lib
const REPO = join(SRC, "..", "..");

const ALLOWED_FILES = new Set([
  "src/lib/voices.ts", // the catalog data itself
  "src/lib/languages.ts", // reads the languages table (when added)
]);

// Code-level branching on a language: comparisons, switch cases, ternaries
// keyed off a language name or BCP-47-ish code.
const HARDCODE_PATTERNS = [
  /languageCode\s*===?\s*["'][a-z]{2}["']/,
  /languageCode\s*!==?\s*["'][a-z]{2}["']/,
  /language\s*===?\s*["'](Hindi|English|Arabic|Japanese|Spanish|French)["']/i,
  /case\s+["'](hi|en|ar|ja|es|fr|de|pt|bn|ur|id|zh)["']\s*:/,
];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      yield* walk(full);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      yield full;
    }
  }
}

describe("language neutrality", () => {
  it("no component branches on a hardcoded language name or code", () => {
    const offenders: string[] = [];
    const srcDir = join(REPO, "src");
    for (const file of walk(srcDir)) {
      const rel = file.slice(REPO.length + 1);
      if (ALLOWED_FILES.has(rel)) continue;
      if (rel.includes("/i18n/")) continue;
      const text = readFileSync(file, "utf8");
      for (const re of HARDCODE_PATTERNS) {
        if (re.test(text)) {
          offenders.push(`${rel} matches ${re}`);
          break;
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
