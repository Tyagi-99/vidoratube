/**
 * F17 Voice Studio — fallback chain tests (Stream D, Phase 3).
 *
 * Mirrors src/lib/providers/video-fallback.test.ts: fakes are injected via
 * `opts.providers` (the only place fakes may appear), and the tests pin
 * chain order, one-attempt-per-provider, and honest envelopes.
 */
import { describe, expect, it, vi } from "vitest";
import {
  synthesizeSpeechWithFallback,
  resolveTtsChain,
  elevenLabsTtsProvider,
  openAiTtsProvider,
  gatewayTtsProvider,
} from "./chain.server";
import type { TtsProvider, TtsResult } from "./types";

function fakeProvider(
  id: string,
  behavior: "ok" | "fail" | "unconfigured",
  calls: string[],
): TtsProvider {
  return {
    id: id as TtsProvider["id"],
    label: id,
    configured: () => behavior !== "unconfigured",
    synthesize: async (text): Promise<TtsResult> => {
      calls.push(id);
      if (behavior === "ok") {
        return {
          ok: true,
          audio: new ArrayBuffer(8),
          provider: id,
          model: `${id}-model`,
          latencyMs: 5,
          characters: text.length,
          unitCostUsd: 0.00001,
          error: null,
        };
      }
      return {
        ok: false,
        audio: null,
        provider: id,
        model: null,
        latencyMs: 5,
        characters: text.length,
        unitCostUsd: null,
        error: { code: `${id}_tts_failed`, message: `${id} exploded` },
      };
    },
  };
}

describe("synthesizeSpeechWithFallback", () => {
  it("uses the first configured provider and stops (no extra paid attempts)", async () => {
    const calls: string[] = [];
    const chain = [
      fakeProvider("elevenlabs", "ok", calls),
      fakeProvider("openai", "ok", calls),
      fakeProvider("gateway", "ok", calls),
    ];
    const result = await synthesizeSpeechWithFallback(
      "hello",
      { voiceId: "v", model: "m" },
      { providers: chain },
    );
    expect(result.ok).toBe(true);
    expect(result.provider).toBe("elevenlabs");
    expect(calls).toEqual(["elevenlabs"]);
  });

  it("falls through in order: elevenlabs fails -> openai wins -> gateway untouched", async () => {
    const calls: string[] = [];
    const chain = [
      fakeProvider("elevenlabs", "fail", calls),
      fakeProvider("openai", "ok", calls),
      fakeProvider("gateway", "ok", calls),
    ];
    const result = await synthesizeSpeechWithFallback(
      "hello",
      { voiceId: "v", model: "m" },
      { providers: chain },
    );
    expect(result.ok).toBe(true);
    expect(result.provider).toBe("openai");
    expect(calls).toEqual(["elevenlabs", "openai"]);
  });

  it("makes exactly one attempt per provider — no blind paid retries", async () => {
    const calls: string[] = [];
    const chain = [
      fakeProvider("elevenlabs", "fail", calls),
      fakeProvider("openai", "fail", calls),
    ];
    const result = await synthesizeSpeechWithFallback(
      "hello",
      { voiceId: "v", model: "m" },
      { providers: chain },
    );
    expect(result.ok).toBe(false);
    // Each provider attempted exactly once.
    expect(calls).toEqual(["elevenlabs", "openai"]);
    // The last provider's honest error is returned, not invented success.
    expect(result.error?.code).toBe("openai_tts_failed");
  });

  it("skips unconfigured providers without any call", async () => {
    const calls: string[] = [];
    const chain = [
      fakeProvider("elevenlabs", "unconfigured", calls),
      fakeProvider("openai", "unconfigured", calls),
      fakeProvider("gateway", "unconfigured", calls),
    ];
    const result = await synthesizeSpeechWithFallback(
      "hello",
      { voiceId: "v", model: "m" },
      { providers: chain },
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("unconfigured");
    expect(calls).toEqual([]);
  });

  it("converts a throwing adapter into an error result and moves on", async () => {
    const calls: string[] = [];
    const throwing: TtsProvider = {
      id: "elevenlabs",
      label: "boom",
      configured: () => true,
      synthesize: async () => {
        calls.push("elevenlabs");
        throw new Error("socket exploded");
      },
    };
    const chain = [throwing, fakeProvider("openai", "ok", calls)];
    const result = await synthesizeSpeechWithFallback(
      "hello",
      { voiceId: "v", model: "m" },
      { providers: chain },
    );
    expect(result.ok).toBe(true);
    expect(result.provider).toBe("openai");
    expect(calls).toEqual(["elevenlabs", "openai"]);
  });

  it("returns unconfigured when the chain is empty", async () => {
    const result = await synthesizeSpeechWithFallback(
      "hello",
      { voiceId: "v", model: "m" },
      { providers: [] },
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("unconfigured");
    expect(result.audio).toBeNull();
  });

  it("does not write api_usage when no costCtx is given", async () => {
    const calls: string[] = [];
    const chain = [fakeProvider("elevenlabs", "ok", calls)];
    // No costCtx — the call must not attempt any bookkeeping.
    const result = await synthesizeSpeechWithFallback(
      "hello",
      { voiceId: "v", model: "m" },
      { providers: chain },
    );
    expect(result.ok).toBe(true);
  });
});

describe("resolveTtsChain", () => {
  it("orders elevenlabs -> openai -> gateway", () => {
    vi.stubEnv("VOICE_TTS_FALLBACK", "");
    const chain = resolveTtsChain();
    expect(chain.map((p) => p.id)).toEqual(["elevenlabs", "openai", "gateway"]);
    vi.unstubAllEnvs();
  });

  it("ignores an unknown VOICE_TTS_FALLBACK id (fail closed)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("VOICE_TTS_FALLBACK", "phantom");
    const chain = resolveTtsChain();
    expect(chain.map((p) => p.id)).toEqual(["elevenlabs", "openai", "gateway"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    vi.unstubAllEnvs();
  });

  it("adapter ids are the registered provider ids", () => {
    expect(elevenLabsTtsProvider.id).toBe("elevenlabs");
    expect(openAiTtsProvider.id).toBe("openai");
    expect(gatewayTtsProvider.id).toBe("gateway");
  });
});
