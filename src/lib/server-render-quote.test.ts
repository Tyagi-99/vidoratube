import { describe, expect, it } from "vitest";
import { buildServerRenderRows } from "./server-renders.functions";
import { quoteMultiAspectRender, renderCreditCost } from "./billing/per-minute";

/**
 * Sprint 1: quote -> reserve -> settle consistency.
 *
 * The deterministic quote (per-minute.ts, the single source of truth also
 * shown in the RenderPanel BEFORE the render) must be exactly what
 * buildServerRenderRows writes into the renders rows — reserved_minutes,
 * meta.expected_credits, and meta.expected_minutes — so enqueue reserves
 * exactly the quote and finalize_render_billing settles it without deltas.
 * Multiplier math is verified against the pricing module.
 */

function makeScene(duration: number, i = 0) {
  return {
    id: `scene-${i}`,
    number: i,
    narration: "Hello world",
    image: "https://example.com/img.jpg",
    audio: null,
    duration,
    cues: [],
  };
}

type RenderInput = Parameters<typeof buildServerRenderRows>[0]["input"];

function makeInput(overrides: Partial<RenderInput> = {}): RenderInput {
  return {
    projectId: "11111111-1111-4111-8111-111111111111",
    title: "Quote test",
    scenes: [makeScene(300, 0), makeScene(300, 1)], // 600s = 10 finished min
    aspects: ["16:9", "9:16"],
    fps: 30,
    burnCaptions: true,
    musicUrl: null,
    musicVolume: 0.15,
    musicDucking: true,
    voiceoverUrl: null,
    mode: "story",
    ...overrides,
  };
}

describe("quote -> row consistency", () => {
  it("reserves exactly the quoted credits on every aspect row", () => {
    const input = makeInput();
    const rows = buildServerRenderRows({
      userId: "22222222-2222-4222-8222-222222222222",
      groupId: "33333333-3333-4333-8333-333333333333",
      input,
    });
    expect(rows).toHaveLength(2);

    const quote = quoteMultiAspectRender({
      durationSeconds: 600,
      mode: "story",
      aspectCount: 2,
    });
    expect(quote.perAspect.minutes).toBe(10);
    expect(quote.perAspect.totalCredits).toBe(10);
    expect(quote.grandTotal).toBe(20);

    for (const row of rows) {
      expect(row.reserved_minutes).toBe(quote.perAspect.minutes);
      const meta = row.meta as Record<string, unknown>;
      expect(meta["expected_credits"]).toBe(quote.perAspect.totalCredits);
      expect(meta["expected_minutes"]).toBe(quote.perAspect.minutes);
      expect(meta["mode"]).toBe("story");
    }
    const totalReserved = rows.reduce((s, r) => s + (r.reserved_minutes ?? 0), 0);
    expect(totalReserved).toBe(quote.grandTotal);
  });

  it("passes the billing mode through to row meta for cost attribution", () => {
    const rows = buildServerRenderRows({
      userId: "22222222-2222-4222-8222-222222222222",
      groupId: "33333333-3333-4333-8333-333333333333",
      input: makeInput({ mode: "cinema", aspects: ["16:9"] }),
    });
    expect(rows).toHaveLength(1);
    expect((rows[0]!.meta as Record<string, unknown>)["mode"]).toBe("cinema");
  });
});

describe("multiplier math matches the pricing module", () => {
  it("cinema + stock footage bills x1.5 finished minutes", () => {
    const story = renderCreditCost({ durationSeconds: 600, mode: "story" });
    const cinema = renderCreditCost({ durationSeconds: 600, mode: "cinema", stockFootage: true });
    expect(story.totalCredits).toBe(10);
    expect(cinema.modeMultiplier).toBe(1.5);
    expect(cinema.totalCredits).toBe(15);
  });

  it("cinema without stock footage has no mode multiplier", () => {
    const cinema = renderCreditCost({ durationSeconds: 600, mode: "cinema" });
    expect(cinema.modeMultiplier).toBe(1);
    expect(cinema.totalCredits).toBe(10);
  });

  it("premium voice doubles the base", () => {
    const c = renderCreditCost({ durationSeconds: 600, mode: "story", premiumVoice: true });
    expect(c.voiceMultiplier).toBe(2);
    expect(c.totalCredits).toBe(20);
  });

  it("multi-aspect grand total is per-aspect x aspect count", () => {
    const q = quoteMultiAspectRender({ durationSeconds: 600, mode: "story", aspectCount: 3 });
    expect(q.grandTotal).toBe(q.perAspect.totalCredits * 3);
    expect(q.grandTotal).toBe(30);
  });

  it("fractional minutes always round up (minimum 1)", () => {
    const c = renderCreditCost({ durationSeconds: 61, mode: "story" });
    expect(c.minutes).toBe(2);
    expect(c.totalCredits).toBe(2);
  });
});
