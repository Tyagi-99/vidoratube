import { describe, expect, it } from "vitest";
import { buildQuickScript, QUICK_SCRIPT_MIN_SEC, QUICK_SCRIPT_MAX_SEC } from "./script";

const input = {
  topic: "Why do airplane windows have a tiny hole?",
  hook: "Ever noticed the tiny hole at the bottom of your airplane window?",
  facts: [
    {
      text: "That hole is called a breather or bleed hole, and it sits in the middle pane of the window.",
      sourceIds: [],
    },
    {
      text: "It lets cabin air flow between the panes so the outer pane takes the full pressure load.",
      sourceIds: [],
    },
    {
      text: "The middle pane stays unloaded as a failsafe in case the outer pane is ever damaged.",
      sourceIds: [],
    },
  ],
  payoff: "Follow for one surprising explanation every day.",
};

describe("buildQuickScript", () => {
  it("assembles hook + beats + payoff deterministically", () => {
    const a = buildQuickScript(input);
    const b = buildQuickScript(input);
    expect(a.fullText).toBe(b.fullText);
    expect(a.fullText.startsWith(input.hook)).toBe(true);
    expect(a.fullText.endsWith(input.payoff)).toBe(true);
    for (const f of input.facts) expect(a.fullText).toContain(f.text);
    expect(a.beats).toHaveLength(input.facts.length);
  });

  it("targets the 25–35s window at 150 WPM", () => {
    const s = buildQuickScript(input);
    expect(s.durationSecEstimate).toBeGreaterThanOrEqual(QUICK_SCRIPT_MIN_SEC);
    expect(s.durationSecEstimate).toBeLessThanOrEqual(QUICK_SCRIPT_MAX_SEC);
    expect(s.inTargetWindow).toBe(true);
    // 150 WPM estimate: words / 150 * 60
    expect(s.durationSecEstimate).toBeCloseTo((s.wordCount / 150) * 60, 5);
  });

  it("refuses to invent a script without facts", () => {
    expect(() => buildQuickScript({ ...input, facts: [] })).toThrow("at least one verified fact");
    expect(() => buildQuickScript({ ...input, hook: "" })).toThrow("hook");
  });
});
