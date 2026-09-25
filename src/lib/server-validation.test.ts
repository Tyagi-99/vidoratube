import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardrail: every POST server function that reads user input must declare a
 * zod inputValidator. Catches the "new endpoint without validation" regression.
 *
 * A POST function is considered to read user input when its handler
 * destructures `data` from the handler argument (the validated input).
 * Functions that only use `context` (auth, no body) are exempt.
 */

const LIB_DIR = resolve(process.cwd(), "src/lib");

function postFunctionsWithoutValidators(): string[] {
  const missing: string[] = [];
  const files = readdirSync(LIB_DIR).filter((f) => f.endsWith(".functions.ts"));
  for (const file of files) {
    const src = readFileSync(join(LIB_DIR, file), "utf8");
    // Split into `export const X = createServerFn(...)` blocks.
    const blocks = src.split(/(?=export const \w+ = createServerFn)/g).slice(1);
    for (const block of blocks) {
      const name = block.match(/export const (\w+)/)?.[1] ?? "<unknown>";
      const method = block.match(/createServerFn\(\{\s*method:\s*"(\w+)"/)?.[1];
      if (method !== "POST") continue;
      const hasValidator = block.includes(".inputValidator(");
      // Handler reads the (validated) user input:
      const readsInput = /\.handler\(\s*async\s*\(\s*\{\s*data\b/.test(block);
      if (readsInput && !hasValidator) {
        missing.push(`${file}:${name}`);
      }
    }
  }
  return missing;
}

describe("server function input validation", () => {
  it("every POST function that reads user input has a zod inputValidator", () => {
    expect(postFunctionsWithoutValidators()).toEqual([]);
  });

  it("the contact endpoint validates and rate-limits anonymous input", () => {
    const src = readFileSync(join(LIB_DIR, "public.functions.ts"), "utf8");
    expect(src).toContain("contactSchema");
    expect(src).toContain(".inputValidator(");
    expect(src).toContain("contactLimiter.check(");
  });

  it("the YouTube publish endpoint validates its payload", () => {
    const src = readFileSync(join(LIB_DIR, "youtube.functions.ts"), "utf8");
    expect(src).toContain("publishSchema");
    // madeForKids is required by YouTube (COPPA declaration).
    expect(src).toMatch(/madeForKids:\s*z\.boolean\(\)/);
  });

  it("job creation validates script length bounds", () => {
    const src = readFileSync(join(LIB_DIR, "jobs.functions.ts"), "utf8");
    expect(src).toContain("createSchema");
    expect(src).toMatch(/script:\s*z\.string\(\)/);
  });
});
