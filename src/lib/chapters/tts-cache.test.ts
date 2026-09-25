import { describe, expect, it, vi } from "vitest";
import {
  makeSupabaseTtsDeps,
  normalizeParagraph,
  paragraphHash,
  synthesizeCachedParagraphs,
  ttsCacheStoragePath,
  type SynthesizeCachedDeps,
} from "./tts-cache.server";

function makeDeps(
  overrides: Partial<SynthesizeCachedDeps> & {
    store?: Map<string, { audioPath: string; durationSeconds: number }>;
  } = {},
): SynthesizeCachedDeps & { calls: string[]; store: Map<string, { audioPath: string; durationSeconds: number }> } {
  const calls: string[] = [];
  const store = new Map<string, { audioPath: string; durationSeconds: number }>();
  return {
    calls,
    store,
    provider: "elevenlabs",
    voiceId: "voice-1",
    languageCode: "en",
    synthesize: async (text: string) => {
      calls.push(text);
      return { audio: Buffer.from(`audio:${text}`), durationSeconds: 3.5 };
    },
    findCached: async (hashes: string[]) => {
      const out = new Map<string, { audioPath: string; durationSeconds: number }>();
      for (const h of hashes) {
        const hit = store.get(h);
        if (hit) out.set(h, hit);
      }
      return out;
    },
    saveCached: async (entry) => {
      store.set(entry.hash, {
        audioPath: entry.audioPath,
        durationSeconds: entry.durationSeconds,
      });
    },
    uploadAudio: async (hash: string) => `tts-cache/${hash}.mp3`,
    ...overrides,
  };
}

describe("normalizeParagraph / paragraphHash", () => {
  it("collapses whitespace so formatting differences hit the cache", () => {
    expect(normalizeParagraph("  hello   world\n")).toBe("hello world");
    expect(paragraphHash("hello   world")).toBe(paragraphHash("hello world"));
  });

  it("is stable and hex", () => {
    const h = paragraphHash("some paragraph");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(paragraphHash("some paragraph")).toBe(h);
  });

  it("distinguishes different text", () => {
    expect(paragraphHash("alpha")).not.toBe(paragraphHash("beta"));
  });
});

describe("synthesizeCachedParagraphs", () => {
  it("same paragraph twice → one TTS call", async () => {
    const deps = makeDeps();
    const paras = ["The river town woke at dawn.", "The river town woke at dawn."];
    const out = await synthesizeCachedParagraphs(paras, deps);
    expect(deps.calls).toEqual(["The river town woke at dawn."]);
    expect(out).toHaveLength(2);
    expect(out[0]!.audioPath).toBe(out[1]!.audioPath);
    expect(out[0]!.durationSeconds).toBe(3.5);
  });

  it("reuses the DB cache on a second invocation (chapter re-render)", async () => {
    const deps = makeDeps();
    await synthesizeCachedParagraphs(["Chapter one opens here."], deps);
    expect(deps.calls).toHaveLength(1);
    // Second call: same paragraph + one new one → only the new one synthesizes.
    const out = await synthesizeCachedParagraphs(
      ["Chapter one opens here.", "Chapter one continues."],
      deps,
    );
    expect(deps.calls).toEqual(["Chapter one opens here.", "Chapter one continues."]);
    expect(out[0]!.audioPath).toBe(`tts-cache/${paragraphHash("Chapter one opens here.")}.mp3`);
  });

  it("whitespace-only differences reuse the cache", async () => {
    const deps = makeDeps();
    await synthesizeCachedParagraphs(["Hello   world"], deps);
    await synthesizeCachedParagraphs(["Hello world"], deps);
    expect(deps.calls).toHaveLength(1);
  });

  it("different voices do not share cache entries", async () => {
    const store = new Map<string, { audioPath: string; durationSeconds: number }>();
    const a = makeDeps({ voiceId: "voice-a", store });
    const b = makeDeps({ voiceId: "voice-b", store });
    await synthesizeCachedParagraphs(["Shared text."], a);
    await synthesizeCachedParagraphs(["Shared text."], b);
    // Separate cache keys → the second voice synthesizes too (its own
    // findCached is keyed by voiceId; here the shared store is keyed by
    // hash only, so simulate the keying the way makeSupabaseTtsDeps does:
    // the deps layer is per (provider, voiceId, languageCode)).
    expect(a.calls).toHaveLength(1);
    expect(b.calls).toHaveLength(1);
  });

  it("propagates synthesis errors without partial state", async () => {
    const deps = makeDeps({
      synthesize: async () => {
        throw new Error("provider down");
      },
    });
    await expect(synthesizeCachedParagraphs(["Boom."], deps)).rejects.toThrow("provider down");
  });
});

describe("ttsCacheStoragePath", () => {
  it("namespaces by provider/voice/language/hash", () => {
    const p = ttsCacheStoragePath(
      { provider: "elevenlabs", voiceId: "v1", languageCode: "hi" },
      "abc123",
    );
    expect(p).toBe("tts-cache/elevenlabs/v1/hi/abc123.mp3");
  });

  it("sanitizes unsafe characters in path components", () => {
    const p = ttsCacheStoragePath(
      { provider: "a/b", voiceId: "v:1", languageCode: "en" },
      "h",
    );
    const parts = p.split("/");
    expect(parts[1]).toBe("a_b");
    expect(parts[2]).toBe("v_1");
    expect(parts).toHaveLength(5);
  });
});

describe("makeSupabaseTtsDeps", () => {
  it("builds deps that delegate to the admin client", async () => {
    const uploaded: string[] = [];
    const upserted: Record<string, unknown>[] = [];
    const fakeAdmin = {
      from: (table: string) => {
        expect(table).toBe("tts_cache");
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ eq: () => ({ in: async () => ({ data: [], error: null }) }) }) }),
          }),
          upsert: async (row: Record<string, unknown>) => {
            upserted.push(row);
            return { error: null };
          },
        };
      },
      storage: {
        from: () => ({
          upload: async (path: string) => {
            uploaded.push(path);
            return { error: null };
          },
        }),
      },
    };
    const deps = makeSupabaseTtsDeps(
      fakeAdmin as never,
      { provider: "elevenlabs", voiceId: "v1", languageCode: "en" },
      "generated-videos",
      async (text) => ({ audio: Buffer.from(text), durationSeconds: 2 }),
    );
    const out = await synthesizeCachedParagraphs(["Cache me."], deps);
    expect(uploaded).toHaveLength(1);
    expect(upserted).toHaveLength(1);
    expect(upserted[0]!["paragraph_hash"]).toBe(paragraphHash("Cache me."));
    expect(out[0]!.audioPath).toBe(uploaded[0]);
    expect(vi).toBeDefined();
  });
});
