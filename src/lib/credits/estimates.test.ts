/**
 * Pinned-vector unit tests for credit-cost ESTIMATES.
 *
 * Every vector below is hand-computed from the documented pricing basis:
 * - per-minute.ts: 1 credit = 1 finished minute (story, standard voice)
 * - api-cost.ts: ElevenLabs Flash $0.05/1k chars, Multilingual $0.10/1k chars,
 *   gateway TTS $0.016/1k chars, gateway image $0.03/image
 * - USD_PER_CREDIT_REFERENCE = $49/200 = $0.245 (Studio plan, billing/plans.ts)
 * - ledger credits are whole numbers: estimates always round UP
 *
 * If a vector fails after a pricing change, the pricing basis changed —
 * update the vector AND the documented basis, never just the vector.
 */
import { describe, expect, it } from "vitest";
import {
  estimateJobCost,
  ESTIMATE_TYPE,
  USD_PER_CREDIT_REFERENCE,
  TTS_CHARS_PER_MINUTE,
} from "./estimates.server";

describe("estimateJobCost labels every result as an ESTIMATE", () => {
  it("carries isEstimate: true and type 'estimate' on priced and unpriced results", () => {
    const results = [
      estimateJobCost({ jobType: "render", minutes: 2 }),
      estimateJobCost({ jobType: "tts", provider: "elevenlabs", characters: 100 }),
      estimateJobCost({ jobType: "tts", provider: "unknown-provider", characters: 100 }),
    ];
    for (const r of results) {
      expect(r.isEstimate).toBe(true);
      expect(r.type).toBe(ESTIMATE_TYPE);
    }
  });
});

describe("render estimates (per-minute billing)", () => {
  it("story mode, standard voice: 1 credit per finished minute", () => {
    const r = estimateJobCost({ jobType: "render", minutes: 3 });
    expect(r.credits).toBe(3);
    if (r.credits !== null) {
      expect(r.breakdown.render?.totalCredits).toBe(3);
    }
  });

  it("premium voice doubles the base (x2 multiplier)", () => {
    const r = estimateJobCost({ jobType: "render", minutes: 3, premiumVoice: true });
    expect(r.credits).toBe(6);
  });

  it("cinema stock footage: x1.5, rounded up to whole credits", () => {
    // 3 min x 1.5 = 4.5 -> 5
    const r = estimateJobCost({ jobType: "render", minutes: 3, stockFootage: true });
    expect(r.credits).toBe(5);
  });

  it("AI hero shots: 1 credit per 10s rounded up (25s -> 3)", () => {
    const r = estimateJobCost({ jobType: "render", minutes: 2, aiHeroSeconds: 25 });
    // 2 base + ceil(25/10)=3
    expect(r.credits).toBe(5);
  });

  it("unknown provider is fine for renders (house per-minute pricing)", () => {
    const r = estimateJobCost({ jobType: "render", minutes: 2, provider: "mystery-engine" });
    expect(r.credits).toBe(2);
  });

  it("shotstack provider adds a USD reference ($0.25/rendered min)", () => {
    const r = estimateJobCost({ jobType: "render", minutes: 4, provider: "shotstack" });
    expect(r.credits).toBe(4);
    if (r.credits !== null) {
      expect(r.breakdown.usdReference).toBe(1.0);
    }
  });
});

describe("tts estimates (USD price -> credits)", () => {
  it("elevenlabs flash: 1000 chars = $0.05 -> ceil(0.05/0.245) = 1 credit", () => {
    const r = estimateJobCost({ jobType: "tts", provider: "elevenlabs", characters: 1000 });
    expect(r.credits).toBe(1);
    if (r.credits !== null) {
      expect(r.breakdown.costBasis).toBe("list-price");
      expect(r.breakdown.usdPerCreditReference).toBe(USD_PER_CREDIT_REFERENCE);
    }
  });

  it("elevenlabs multilingual model uses the $0.10/1k rate", () => {
    const r = estimateJobCost({
      jobType: "tts",
      provider: "elevenlabs",
      model: "eleven_multilingual_v2",
      characters: 1000,
    });
    // $0.10 / 0.245 = 0.408 -> 1
    expect(r.credits).toBe(1);
  });

  it("large narration scales: 100k chars flash = $5.00 -> ceil(5/0.245) = 21 credits", () => {
    const r = estimateJobCost({ jobType: "tts", provider: "elevenlabs", characters: 100_000 });
    expect(r.credits).toBe(21); // 5 / 0.245 = 20.408 -> 21
  });

  it("gateway tts uses the passthrough estimate rate ($0.016/1k)", () => {
    const r = estimateJobCost({ jobType: "tts", provider: "lovable-ai", characters: 10_000 });
    // $0.16 / 0.245 = 0.653 -> 1
    expect(r.credits).toBe(1);
    if (r.credits !== null) {
      expect(r.breakdown.costBasis).toBe("gateway-passthrough-estimate");
    }
  });

  it("minutes fallback: 2 min x 750 chars/min = 1500 chars", () => {
    expect(TTS_CHARS_PER_MINUTE).toBe(750);
    const r = estimateJobCost({ jobType: "tts", provider: "elevenlabs", minutes: 2 });
    // $0.075 / 0.245 = 0.306 -> 1
    expect(r.credits).toBe(1);
  });

  it("unknown provider -> null credits, no invented price", () => {
    const r = estimateJobCost({ jobType: "tts", provider: "acme-tts", characters: 1000 });
    expect(r.credits).toBeNull();
    if (r.credits === null) {
      expect(r.reason).toBe("unknown_provider_pricing");
      expect(r.breakdown).toBeNull();
    }
  });
});

describe("image estimates", () => {
  it("gateway: 4 scenes = 4 x $0.03 = $0.12 -> 1 credit", () => {
    const r = estimateJobCost({ jobType: "image", provider: "lovable-ai", scenes: 4 });
    expect(r.credits).toBe(1);
  });

  it("unknown provider -> null credits, no invented price", () => {
    const r = estimateJobCost({ jobType: "image", provider: "midjourney", scenes: 4 });
    expect(r.credits).toBeNull();
    if (r.credits === null) expect(r.reason).toBe("unknown_provider_pricing");
  });
});

describe("llm_chat estimates", () => {
  it("gateway chat with token counts prices from the Gemini 2.5 Flash list price", () => {
    const r = estimateJobCost({
      jobType: "llm_chat",
      provider: "lovable-ai",
      tokens: { input: 1_000_000, output: 0 },
    });
    // $0.30 / 0.245 = 1.224 -> 2
    expect(r.credits).toBe(2);
  });

  it("missing token counts -> insufficient_input_for_estimate (usage never invented)", () => {
    const r = estimateJobCost({ jobType: "llm_chat", provider: "lovable-ai" });
    expect(r.credits).toBeNull();
    if (r.credits === null) expect(r.reason).toBe("insufficient_input_for_estimate");
  });
});

describe("video_gen estimates", () => {
  it("no published price -> null credits, no invented price", () => {
    const r = estimateJobCost({ jobType: "video_gen", provider: "fal.ai", minutes: 1 });
    expect(r.credits).toBeNull();
    if (r.credits === null) expect(r.reason).toBe("unknown_provider_pricing");
  });
});
