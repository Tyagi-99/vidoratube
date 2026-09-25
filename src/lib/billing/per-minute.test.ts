import { describe, expect, it } from "vitest";
import {
  aiHeroCredits,
  finishedMinutes,
  formatRenderCost,
  quoteMultiAspectRender,
  renderCreditCost,
} from "./per-minute";

describe("finishedMinutes", () => {
  it("rounds up to whole minutes, minimum 1", () => {
    expect(finishedMinutes(60)).toBe(1);
    expect(finishedMinutes(61)).toBe(2);
    expect(finishedMinutes(240)).toBe(4);
    expect(finishedMinutes(0)).toBe(1);
    expect(finishedMinutes(-5)).toBe(1);
    expect(finishedMinutes(NaN)).toBe(1);
  });
});

describe("renderCreditCost", () => {
  it("charges 1 credit per finished minute for story + standard voice", () => {
    expect(renderCreditCost({ durationSeconds: 240, mode: "story" }).totalCredits).toBe(4);
    expect(renderCreditCost({ durationSeconds: 30, mode: "story" }).totalCredits).toBe(1);
  });

  it("doubles for premium voice", () => {
    const c = renderCreditCost({ durationSeconds: 240, mode: "story", premiumVoice: true });
    expect(c.totalCredits).toBe(8);
    expect(c.voiceMultiplier).toBe(2);
  });

  it("applies x1.5 for cinema stock footage", () => {
    const c = renderCreditCost({ durationSeconds: 240, mode: "cinema", stockFootage: true });
    expect(c.totalCredits).toBe(6); // 4 * 1.5
    expect(c.modeMultiplier).toBe(1.5);
  });

  it("does not apply the stock multiplier to story mode", () => {
    const c = renderCreditCost({ durationSeconds: 240, mode: "story", stockFootage: true });
    expect(c.modeMultiplier).toBe(1);
  });

  it("bills AI hero shots per second (1 credit per 10s, rounded up)", () => {
    expect(aiHeroCredits(0)).toBe(0);
    expect(aiHeroCredits(10)).toBe(1);
    expect(aiHeroCredits(11)).toBe(2);
    const c = renderCreditCost({ durationSeconds: 240, mode: "story", aiHeroSeconds: 25 });
    expect(c.aiHeroCredits).toBe(3);
    expect(c.totalCredits).toBe(7); // 4 + 3
  });

  it("adds 0.25/min for 2.5D parallax, rounding up the total", () => {
    const c = renderCreditCost({ durationSeconds: 240, mode: "story", parallax25d: true });
    expect(c.parallaxCredits).toBe(1); // 4 * 0.25
    expect(c.totalCredits).toBe(5);
  });

  it("charges dubbing at 0.5/min/language", () => {
    const c = renderCreditCost({ durationSeconds: 240, mode: "story", dubLanguages: 2 });
    expect(c.dubbingCredits).toBe(4); // 4 * 0.5 * 2
    expect(c.totalCredits).toBe(8);
  });

  it("charges shorts at 0.5 each, rounding up", () => {
    const c = renderCreditCost({ durationSeconds: 240, mode: "story", shortsCount: 3 });
    expect(c.shortsCredits).toBe(1.5);
    expect(c.totalCredits).toBe(6); // ceil(4 + 1.5)
  });

  it("combines everything", () => {
    // 10-min cinema + stock + premium voice + parallax + 1 dub language
    const c = renderCreditCost({
      durationSeconds: 600,
      mode: "cinema",
      stockFootage: true,
      premiumVoice: true,
      parallax25d: true,
      dubLanguages: 1,
    });
    // base 10*1.5*2=30, parallax 2.5, dub 5 -> 37.5 -> 38
    expect(c.totalCredits).toBe(38);
  });

  it("never charges zero", () => {
    expect(renderCreditCost({ durationSeconds: 1, mode: "story" }).totalCredits).toBe(1);
  });
});

describe("formatRenderCost", () => {
  it("renders a readable cost line", () => {
    expect(formatRenderCost({ durationSeconds: 240, mode: "story" })).toBe(
      "4 min story = 4 credits",
    );
    expect(
      formatRenderCost({ durationSeconds: 240, mode: "story", premiumVoice: true }),
    ).toBe("4 min story + premium voice x2 = 8 credits");
  });
});

describe("quoteMultiAspectRender", () => {
  it("multiplies the per-aspect quote by the aspect count", () => {
    // 4-min story = 4 credits per aspect; 3 aspects = 12 total.
    const q = quoteMultiAspectRender({ durationSeconds: 240, mode: "story", aspectCount: 3 });
    expect(q.perAspect.totalCredits).toBe(4);
    expect(q.aspectCount).toBe(3);
    expect(q.grandTotal).toBe(12);
  });

  it("clamps the aspect count to at least 1", () => {
    const q = quoteMultiAspectRender({ durationSeconds: 61, mode: "story", aspectCount: 0 });
    expect(q.aspectCount).toBe(1);
    expect(q.grandTotal).toBe(q.perAspect.totalCredits);
  });

  it("applies multipliers per aspect before multiplying", () => {
    // 2-min cinema + stock = 3 credits per aspect; x2 aspects = 6.
    const q = quoteMultiAspectRender({
      durationSeconds: 120,
      mode: "cinema",
      stockFootage: true,
      aspectCount: 2,
    });
    expect(q.perAspect.totalCredits).toBe(3);
    expect(q.grandTotal).toBe(6);
  });
});
