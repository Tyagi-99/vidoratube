import { describe, expect, it } from "vitest";
import { buildPlanSystemPrompt } from "./jobs.server";

describe("buildPlanSystemPrompt", () => {
  it("keeps the standard prompt byte-identical when storyMode is off", () => {
    const plain = buildPlanSystemPrompt("documentary", "george", false);
    const def = buildPlanSystemPrompt("documentary", "george");
    expect(plain).toBe(def);
    expect(plain).toContain('suited to the "george" voice');
    expect(plain).not.toContain("HOOK");
    expect(plain).not.toContain("RISING TENSION");
  });

  it("appends the five-beat story guidance in story mode", () => {
    const p = buildPlanSystemPrompt("documentary", "george", true);
    expect(p).toContain('suited to the "george" voice');
    for (const token of ["HOOK", "SETUP", "RISING TENSION", "PAYOFF", "LOOP / CTA"]) {
      expect(p).toContain(token);
    }
  });

  it("stays language-neutral: no language names in the guidance", () => {
    const p = buildPlanSystemPrompt("documentary", "george", true);
    for (const lang of ["english", "hindi", "spanish", "german"]) {
      expect(p.toLowerCase()).not.toContain(lang);
    }
  });
});
