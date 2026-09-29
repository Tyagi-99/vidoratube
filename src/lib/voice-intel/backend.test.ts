/**
 * Voice Intelligence backend tests (Stream B).
 *
 * Covers the pure helpers in backend.server.ts and the server-function
 * handlers in voice-intel.functions.ts with the server boundary mocked
 * (createServerFn middleware, TTS chain, provider validation, storage,
 * credit preflight). No real provider APIs, no network, no paid calls —
 * every paid path is a vi.fn().
 *
 * Honesty assertions: UNMAPPED_VOICE never synthesizes, NO_TTS_PROVIDER
 * precedes any provider call, previews use the character's OWN voice id
 * (never the multi-provider chain), and error codes are never raw
 * provider strings.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => {
  const chain: Record<string, (...args: never[]) => unknown> = {};
  chain["middleware"] = () => chain;
  chain["inputValidator"] = () => chain;
  chain["handler"] = (fn: (...args: never[]) => unknown) => fn;
  return {
    createServerFn: () => chain,
    createMiddleware: () => ({ server: (fn: unknown) => fn }),
  };
});

const mocks = vi.hoisted(() => ({
  elevenLabsConfiguredValue: true,
  elevenLabsSynthesize: vi.fn(),
  synthesizeSpeechWithFallback: vi.fn(),
  mp3Duration: vi.fn(),
  validateVoice: vi.fn(),
  listModels: vi.fn(),
  preflightCreditsCheck: vi.fn(),
  debitMinutesForJob: vi.fn(),
  storageUpload: vi.fn(),
  storageSign: vi.fn(),
}));

vi.mock("../creation/voice/chain.server", () => ({
  elevenLabsTtsProvider: {
    id: "elevenlabs",
    label: "ElevenLabs",
    configured: () => mocks.elevenLabsConfiguredValue,
    synthesize: mocks.elevenLabsSynthesize,
  },
  synthesizeSpeechWithFallback: mocks.synthesizeSpeechWithFallback,
  ttsAvailable: () => mocks.elevenLabsConfiguredValue,
}));

vi.mock("../providers/voice.server", () => ({
  elevenLabsConfigured: () => mocks.elevenLabsConfiguredValue,
  mp3Duration: mocks.mp3Duration,
}));

vi.mock("../providers/openai-tts.server", () => ({
  openAiTtsConfigured: () => false,
}));

vi.mock("./provider.server", () => ({
  elevenLabsVoiceProvider: {
    id: "elevenlabs",
    label: "ElevenLabs",
    configured: () => mocks.elevenLabsConfiguredValue,
    listModels: mocks.listModels,
    validateVoice: mocks.validateVoice,
    synthesize: mocks.elevenLabsSynthesize,
  },
}));

vi.mock("../credits/preflight.server", () => ({
  preflightCreditsCheck: mocks.preflightCreditsCheck,
}));

vi.mock("@/lib/credits", () => ({
  debitMinutesForJob: mocks.debitMinutesForJob,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        upload: mocks.storageUpload,
        createSignedUrl: mocks.storageSign,
      }),
    },
  },
}));

import {
  compareVoices,
  estimateVoiceCost,
  getChannelVoiceDefault,
  getProjectVoiceConfig,
  getVoiceFavorites,
  getVoiceProviderStatus,
  checkVoiceAvailability,
  deleteVoiceProfile,
  listVoiceCharacters,
  listVoiceModels,
  listVoiceProfiles,
  previewVoice,
  saveChannelVoiceDefault,
  saveProjectVoiceConfig,
  saveVoiceProfile,
  synthesizeNarration,
  toggleVoiceFavorite,
  trackVoiceEvent,
} from "./voice-intel.functions";
import {
  conservativeModelMetadata,
  defaultPreviewText,
  mapTtsErrorToPreviewCode,
  mergeCharactersWithOverrides,
  mergeModelsWithOverrides,
  mergeProviderModels,
  previewCacheKey,
  resolveModelId,
  sha256Hex,
} from "./backend.server";
import { VOICE_CHARACTERS, VOICE_MODELS, voiceCharacter } from "./catalog";
import { estimateVoiceCost as pureEstimateVoiceCost } from "./cost";
import type { VoiceCharacter } from "./types";

/* ── fake supabase client ──────────────────────────────────────────────── */

type QueueEntry = { data: unknown; error: { code?: string; message: string } | null };

/**
 * Minimal thenable query-builder fake. Each awaited terminal call consumes
 * the next queue entry in order, so multi-step handlers get deterministic
 * per-call results. Method calls are recorded for assertions.
 */
function makeDb(queue: QueueEntry[]) {
  let cursor = 0;
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const next = (): QueueEntry => {
    const entry = queue[Math.min(cursor, queue.length - 1)];
    cursor += 1;
    return entry ?? { data: null, error: null };
  };
  const builder = (table: string): unknown => {
    const b: Record<string, unknown> = {};
    b["then"] = (resolve: (v: QueueEntry) => void) => {
      calls.push({ table, method: "<terminal>", args: [] });
      resolve(next());
    };
    for (const m of [
      "select",
      "insert",
      "update",
      "delete",
      "upsert",
      "eq",
      "order",
      "limit",
      "single",
      "maybeSingle",
    ]) {
      b[m] = (...args: unknown[]) => {
        calls.push({ table, method: m, args });
        return b;
      };
    }
    return b;
  };
  return {
    client: { from: (t: string) => builder(t) } as never,
    calls,
  };
}

const ok = (data: unknown): QueueEntry => ({ data, error: null });
const missingTable = (): QueueEntry => ({
  data: null,
  error: { code: "42P01", message: 'relation "public.x" does not exist' },
});

const ctx = (db: { client: never }) => ({ supabase: db.client, userId: "user-1" });

const ADAM_VOICE_ID = "pNInz6obpgDQGcFmaJgB";

const ttsOkResult = (audio = new ArrayBuffer(16)) => ({
  ok: true,
  audio,
  provider: "elevenlabs",
  model: "eleven_multilingual_v2",
  latencyMs: 50,
  characters: 42,
  unitCostUsd: 0.0001,
  error: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.elevenLabsConfiguredValue = true;
  mocks.elevenLabsSynthesize.mockResolvedValue(ttsOkResult());
  mocks.synthesizeSpeechWithFallback.mockResolvedValue(ttsOkResult());
  mocks.mp3Duration.mockReturnValue(13);
  mocks.validateVoice.mockResolvedValue({ ok: true, status: "ready" });
  mocks.listModels.mockResolvedValue([
    { id: "eleven_multilingual_v2", label: "Eleven Multilingual v2" },
    { id: "eleven_flash_v2_5", label: "Eleven Flash v2.5" },
    { id: "eleven_brand_new_x", label: "Eleven Brand New X" },
  ]);
  mocks.preflightCreditsCheck.mockResolvedValue({
    ok: true,
    estimate: { credits: 2 },
    balance: 100,
    warnings: [],
  });
  mocks.debitMinutesForJob.mockResolvedValue(undefined);
  mocks.storageUpload.mockResolvedValue({ error: null });
  mocks.storageSign.mockResolvedValue({
    data: { signedUrl: "https://cdn.test/preview.mp3" },
    error: null,
  });
});

/* ── pure helpers ──────────────────────────────────────────────────────── */

describe("previewCacheKey", () => {
  it("is deterministic for identical inputs", () => {
    expect(previewCacheKey("adam", "eleven_multilingual_v2", "hello")).toBe(
      previewCacheKey("adam", "eleven_multilingual_v2", "hello"),
    );
  });

  it("changes when any input changes", () => {
    const base = previewCacheKey("adam", "eleven_multilingual_v2", "hello");
    expect(previewCacheKey("elli", "eleven_multilingual_v2", "hello")).not.toBe(base);
    expect(previewCacheKey("adam", "eleven_flash_v2_5", "hello")).not.toBe(base);
    expect(previewCacheKey("adam", "eleven_multilingual_v2", "bye")).not.toBe(base);
  });

  it("is a 64-char hex sha256", () => {
    expect(previewCacheKey("a", "b", "c")).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("mapTtsErrorToPreviewCode", () => {
  it("maps 401 / quota language to TTS_QUOTA_EXHAUSTED", () => {
    expect(
      mapTtsErrorToPreviewCode({ code: "elevenlabs_tts_failed", message: "ElevenLabs: invalid or unauthorised API key (401)" }),
    ).toBe("TTS_QUOTA_EXHAUSTED");
    expect(
      mapTtsErrorToPreviewCode({ code: "x", message: "quota exceeded for this billing period" }),
    ).toBe("TTS_QUOTA_EXHAUSTED");
    expect(mapTtsErrorToPreviewCode({ code: "x", message: "rate limited (429)" })).toBe(
      "TTS_QUOTA_EXHAUSTED",
    );
  });

  it("maps anything else (and null) to TTS_FAILED", () => {
    expect(mapTtsErrorToPreviewCode({ code: "x", message: "socket hangup" })).toBe("TTS_FAILED");
    expect(mapTtsErrorToPreviewCode(null)).toBe("TTS_FAILED");
  });
});

describe("mergeCharactersWithOverrides", () => {
  it("returns the catalog untouched when there are no rows", () => {
    expect(mergeCharactersWithOverrides(VOICE_CHARACTERS, [])).toBe(VOICE_CHARACTERS);
  });

  it("lets DB provider_voice_id/status win when set", () => {
    const merged = mergeCharactersWithOverrides(VOICE_CHARACTERS, [
      {
        id: "sawyer",
        name: "Sawyer",
        language_code: "en",
        gender: "masculine",
        accent: null,
        personality_tags: [],
        category_tags: [],
        description: "",
        recommended_for: [],
        score: 9.6,
        is_default: false,
        provider: "elevenlabs",
        provider_voice_id: "real-voice-id-123",
        supported_models: [],
        status: "verified",
        created_at: "",
        updated_at: "",
      },
    ]);
    const sawyer = merged.find((c) => c.id === "sawyer")!;
    expect(sawyer.providerVoiceId).toBe("real-voice-id-123");
    expect(sawyer.status).toBe("verified");
    // Untouched characters keep catalog values.
    expect(merged.find((c) => c.id === "adam")!.providerVoiceId).toBe(ADAM_VOICE_ID);
  });
});

describe("mergeModelsWithOverrides / mergeProviderModels", () => {
  it("refreshes seed rows from the table and appends table-only rows", () => {
    const merged = mergeModelsWithOverrides(VOICE_MODELS, [
      {
        id: "eleven_flash_v2_5",
        provider: "elevenlabs",
        label: "Eleven Flash v2.5 (renamed)",
        quality: 4,
        speed: "very_fast",
        expressiveness: "medium",
        multilingual: true,
        supported_languages: ["en"],
        best_for: "x",
        cost_multiplier: 1,
        supported_params: [],
        maturity: "stable",
        is_active: true,
        created_at: "",
        updated_at: "",
      },
    ]);
    expect(merged.find((m) => m.id === "eleven_flash_v2_5")!.label).toBe(
      "Eleven Flash v2.5 (renamed)",
    );
    expect(merged).toHaveLength(VOICE_MODELS.length);
  });

  it("gives unknown provider models conservative metadata, never invented capabilities", () => {
    const merged = mergeProviderModels(
      [
        { id: "eleven_multilingual_v2", label: "Eleven Multilingual v2" },
        { id: "eleven_mystery_z", label: "Eleven Mystery Z" },
      ],
      VOICE_MODELS,
    );
    const known = merged.find((m) => m.id === "eleven_multilingual_v2")!;
    expect(known.bestFor).toContain("documentaries");
    expect(known.supportedLanguages.length).toBeGreaterThan(0);
    const unknown = merged.find((m) => m.id === "eleven_mystery_z")!;
    expect(unknown).toMatchObject({
      maturity: "alpha",
      multilingual: false,
      supportedLanguages: [],
      supportedParams: [],
      costMultiplier: 1,
    });
    expect(conservativeModelMetadata("x", "X").quality).toBe(3);
  });
});

describe("resolveModelId", () => {
  const adam = voiceCharacter("adam")!;

  it("keeps an explicit active model id", () => {
    expect(resolveModelId(adam, "hello", "eleven_flash_v2_5")).toBe("eleven_flash_v2_5");
  });

  it("auto-selects for 'auto', missing, or unknown ids", () => {
    // Short text → flash (fastest generation for short-form).
    expect(resolveModelId(adam, "hello", "auto")).toBe("eleven_flash_v2_5");
    expect(resolveModelId(adam, "hello", null)).toBe("eleven_flash_v2_5");
    expect(resolveModelId(adam, "hello", "nope_not_a_model")).toBe("eleven_flash_v2_5");
  });
});

describe("defaultPreviewText", () => {
  it("uses the language's catalog sample", () => {
    const niraj = voiceCharacter("niraj")!;
    expect(defaultPreviewText(niraj)).toContain("कुछ कहानियाँ");
    expect(defaultPreviewText(voiceCharacter("adam")!)).toContain("Some stories");
  });
});

/* ── handlers: catalog / models / status ───────────────────────────────── */

describe("listVoiceCharacters", () => {
  it("falls back to the catalog seed when the tables are missing (42P01)", async () => {
    const db = makeDb([missingTable(), missingTable()]);
    const fn = listVoiceCharacters as unknown as (a: {
      context: { supabase: never; userId: string };
    }) => Promise<{ characters: VoiceCharacter[]; models: unknown[] }>;
    const res = await fn({ context: ctx(db) });
    expect(res.characters).toHaveLength(40);
    expect(res.characters.find((c) => c.id === "adam")!.providerVoiceId).toBe(ADAM_VOICE_ID);
    expect(res.models).toHaveLength(5);
  });

  it("merges DB overrides onto the catalog", async () => {
    const db = makeDb([
      ok([
        {
          id: "sawyer",
          provider_voice_id: "mapped-by-admin",
          status: "verified",
        },
      ]),
      ok([]),
    ]);
    const fn = listVoiceCharacters as unknown as (a: {
      context: { supabase: never; userId: string };
    }) => Promise<{ characters: VoiceCharacter[] }>;
    const res = await fn({ context: ctx(db) });
    const sawyer = res.characters.find((c) => c.id === "sawyer")!;
    expect(sawyer.providerVoiceId).toBe("mapped-by-admin");
    expect(sawyer.status).toBe("verified");
  });
});

describe("listVoiceModels", () => {
  const call = async (db: { client: never }) => {
    const fn = listVoiceModels as unknown as (a: {
      context: { supabase: never; userId: string };
    }) => Promise<{ models: { id: string }[]; source: string }>;
    return fn({ context: ctx(db) });
  };

  it("returns table metadata when no provider key is configured", async () => {
    mocks.elevenLabsConfiguredValue = false;
    const db = makeDb([ok([])]);
    const res = await call(db);
    expect(res.source).toBe("table");
    expect(res.models).toHaveLength(5);
    expect(mocks.listModels).not.toHaveBeenCalled();
  });

  it("falls back to the seed when the table is missing and no key is set", async () => {
    mocks.elevenLabsConfiguredValue = false;
    const db = makeDb([missingTable()]);
    const res = await call(db);
    expect(res.source).toBe("seed");
    expect(res.models).toHaveLength(5);
  });

  it("merges provider ids with curated metadata; unknown ids stay conservative", async () => {
    const db = makeDb([ok([])]);
    const res = await call(db);
    expect(res.source).toBe("provider");
    const ids = res.models.map((m) => m.id);
    expect(ids).toContain("eleven_multilingual_v2");
    expect(ids).toContain("eleven_brand_new_x");
    expect(ids).not.toContain("openai_tts_1"); // provider list drives the merge
    const unknown = res.models.find((m) => m.id === "eleven_brand_new_x")!;
    expect(unknown).toMatchObject({ maturity: "alpha", multilingual: false });
  });

  it("falls back to table metadata when the provider call fails", async () => {
    mocks.listModels.mockRejectedValueOnce(new Error("network down"));
    const db = makeDb([ok([])]);
    const res = await call(db);
    expect(res.source).toBe("table");
    expect(res.models).toHaveLength(5);
  });
});

describe("getVoiceProviderStatus", () => {
  it("mirrors the provider configuration", async () => {
    const fn = getVoiceProviderStatus as unknown as () => Promise<{
      providers: { id: string; configured: boolean; role: string }[];
      anyConfigured: boolean;
    }>;
    const res = await fn();
    expect(res.providers.map((p) => p.id)).toEqual(["elevenlabs", "openai", "gateway"]);
    expect(res.providers[0]).toMatchObject({ configured: true, role: "primary" });
    expect(res.anyConfigured).toBe(true);
  });
});

describe("checkVoiceAvailability", () => {
  const call = (db: { client: never }, characterId: string) => {
    const fn = checkVoiceAvailability as unknown as (a: {
      data: { characterId: string };
      context: { supabase: never; userId: string };
    }) => Promise<{ characterId: string; availability: string; providerConfigured: boolean }>;
    return fn({ data: { characterId }, context: ctx(db) });
  };

  it("returns unmapped for unknown ids without a provider call", async () => {
    const db = makeDb([]);
    const res = await call(db, "nope");
    expect(res.availability).toBe("unmapped");
    expect(mocks.validateVoice).not.toHaveBeenCalled();
  });

  it("returns needs_key when nothing is configured (pure path)", async () => {
    mocks.elevenLabsConfiguredValue = false;
    const db = makeDb([ok(null)]);
    const res = await call(db, "adam");
    expect(res.availability).toBe("needs_key");
    expect(res.providerConfigured).toBe(false);
    expect(mocks.validateVoice).not.toHaveBeenCalled();
  });

  it("validates a mapped voice live: 200 → ready", async () => {
    const db = makeDb([ok(null)]);
    const res = await call(db, "adam");
    expect(mocks.validateVoice).toHaveBeenCalledWith(ADAM_VOICE_ID);
    expect(res.availability).toBe("ready");
    expect(res.providerConfigured).toBe(true);
  });

  it("maps provider 404 → legacy and 401 → needs_key (honest)", async () => {
    const db404 = makeDb([ok(null)]);
    mocks.validateVoice.mockResolvedValueOnce({
      ok: false,
      status: "legacy",
      detail: "gone",
    });
    expect((await call(db404, "adam")).availability).toBe("legacy");

    const db401 = makeDb([ok(null)]);
    mocks.validateVoice.mockResolvedValueOnce({
      ok: false,
      status: "needs_key",
      detail: "bad key",
    });
    const res401 = await call(db401, "adam");
    expect(res401.availability).toBe("needs_key");
    expect(res401.providerConfigured).toBe(false);
  });

  it("does not live-validate unmapped characters", async () => {
    const db = makeDb([ok(null)]);
    const res = await call(db, "niraj");
    expect(res.availability).toBe("unmapped");
    expect(mocks.validateVoice).not.toHaveBeenCalled();
  });
});

/* ── handlers: preview / compare ───────────────────────────────────────── */

describe("previewVoice", () => {
  const call = (db: { client: never }, data: { characterId: string; text?: string; modelId?: string }) => {
    const fn = previewVoice as unknown as (a: {
      data: { characterId: string; text?: string; modelId?: string };
      context: { supabase: never; userId: string };
    }) => Promise<Record<string, unknown>>;
    return fn({ data, context: ctx(db) });
  };

  it("returns NO_TTS_PROVIDER without touching the provider when unconfigured", async () => {
    mocks.elevenLabsConfiguredValue = false;
    const db = makeDb([ok(null)]);
    const res = await call(db, { characterId: "adam" });
    expect(res).toMatchObject({ ok: false, code: "NO_TTS_PROVIDER", fallbackCharacterId: null });
    expect(typeof res["message"]).toBe("string");
    expect(mocks.elevenLabsSynthesize).not.toHaveBeenCalled();
  });

  it("returns UNMAPPED_VOICE (null fallback) for a character with no compatible fallback", async () => {
    // niraj (hi) — no mapped Hindi voice exists in the catalog.
    const db = makeDb([ok(null)]);
    const res = await call(db, { characterId: "niraj" });
    expect(res).toMatchObject({ ok: false, code: "UNMAPPED_VOICE", fallbackCharacterId: null });
    expect(mocks.elevenLabsSynthesize).not.toHaveBeenCalled();
  });

  it("returns the cached URL without synthesizing on a cache hit", async () => {
    const db = makeDb([ok(null), ok({ audio_url: "https://cdn.test/cached.mp3" })]);
    const res = await call(db, { characterId: "adam", text: "hello" });
    expect(res).toMatchObject({
      ok: true,
      audioUrl: "https://cdn.test/cached.mp3",
      cached: true,
      characterId: "adam",
      viaFallback: false,
    });
    expect(mocks.elevenLabsSynthesize).not.toHaveBeenCalled();
    expect(mocks.storageUpload).not.toHaveBeenCalled();
  });

  it("synthesizes with the character's own voice id, stores, signs, and caches", async () => {
    const db = makeDb([ok(null), ok(null), ok(null)]);
    const res = await call(db, { characterId: "adam", text: "hello" });
    expect(res).toMatchObject({
      ok: true,
      audioUrl: "https://cdn.test/preview.mp3",
      cached: false,
      characterId: "adam",
      viaFallback: false,
      fallbackNote: null,
    });
    expect(mocks.elevenLabsSynthesize).toHaveBeenCalledTimes(1);
    const [text, synthOpts] = mocks.elevenLabsSynthesize.mock.calls[0] as unknown as [
      string,
      { voiceId: string; model: string },
    ];
    expect(text).toBe("hello");
    expect(synthOpts.voiceId).toBe(ADAM_VOICE_ID); // the character's OWN voice
    expect(synthOpts.model).toBe("eleven_flash_v2_5"); // auto-selected for short text
    expect(mocks.storageUpload).toHaveBeenCalledTimes(1);
    const uploadArgs = mocks.storageUpload.mock.calls[0] as unknown as [string, ArrayBuffer, object];
    expect(uploadArgs[0]).toMatch(/^user-1\/voice-previews\/[0-9a-f]{64}\.mp3$/);
    // Cache row written.
    const insertCall = db.calls.find((c) => c.table === "generated_voice_previews" && c.method === "insert");
    expect(insertCall).toBeDefined();
    expect(insertCall!.args[0]).toMatchObject({
      user_id: "user-1",
      character_id: "adam",
      audio_url: "https://cdn.test/preview.mp3",
    });
  });

  it("uses the language sample as default text when none is given", async () => {
    const db = makeDb([ok(null), ok(null), ok(null)]);
    await call(db, { characterId: "adam" });
    const [text] = mocks.elevenLabsSynthesize.mock.calls[0] as unknown as [string];
    expect(text).toContain("Some stories change the way we see the world");
  });

  it("synthesizes a mapped voice with its own account voice id (no fallback)", async () => {
    // sawyer is mapped to the user's own ElevenLabs "Charlie" voice —
    // mapped voices synthesize directly, never via fallback.
    const db = makeDb([ok(null), ok(null), ok(null)]);
    const res = await call(db, { characterId: "sawyer", text: "dark tale" });
    expect(res).toMatchObject({ ok: true, characterId: "sawyer", viaFallback: false });
    const [, synthOpts] = mocks.elevenLabsSynthesize.mock.calls[0] as unknown as [
      string,
      { voiceId: string },
    ];
    expect(synthOpts.voiceId).toBe("IKne3meq5aSn9XLyUdCD");
  });

  it("maps a 401 provider failure to TTS_QUOTA_EXHAUSTED with friendly copy", async () => {
    mocks.elevenLabsSynthesize.mockResolvedValueOnce({
      ok: false,
      audio: null,
      provider: "elevenlabs",
      model: null,
      latencyMs: 10,
      characters: 5,
      unitCostUsd: null,
      error: { code: "elevenlabs_tts_failed", message: "ElevenLabs: invalid or unauthorised API key (401)" },
    });
    const db = makeDb([ok(null), ok(null)]);
    const res = await call(db, { characterId: "adam", text: "hi" });
    expect(res).toMatchObject({ ok: false, code: "TTS_QUOTA_EXHAUSTED", fallbackCharacterId: null });
    expect(res["message"]).not.toContain("401");
  });
});

describe("compareVoices", () => {
  it("previews in parallel and reports per-item audioUrl/error", async () => {
    const fn = compareVoices as unknown as (a: {
      data: { characterIds: string[]; text: string };
      context: { supabase: never; userId: string };
    }) => Promise<{ results: { characterId: string; audioUrl: string | null; error: string | null }[] }>;
    // adam: char row miss, cache miss, cache insert. niraj: char row miss (no fallback).
    const db = makeDb([ok(null), ok(null), ok(null), ok(null)]);
    const res = await fn({ data: { characterIds: ["adam", "niraj"], text: "same text" }, context: ctx(db) });
    expect(res.results).toHaveLength(2);
    expect(res.results[0]).toMatchObject({ characterId: "adam", error: null });
    expect(res.results[0]!.audioUrl).toBe("https://cdn.test/preview.mp3");
    expect(res.results[1]).toMatchObject({ characterId: "niraj", audioUrl: null });
    expect(typeof res.results[1]!.error).toBe("string");
    expect(res.results[1]!.error).not.toContain("UNMAPPED_VOICE");
  });
});

/* ── handlers: narration ───────────────────────────────────────────────── */

describe("synthesizeNarration", () => {
  const selection = {
    languageCode: "en",
    categoryId: null,
    characterId: "adam",
    modelId: "eleven_multilingual_v2",
    settings: { stability: 0.5, similarityBoost: 0.75, style: 0.3, speed: 1, speakerBoost: true },
    customised: false,
  };
  const call = (db: { client: never }, data: Record<string, unknown>) => {
    const fn = synthesizeNarration as unknown as (a: {
      data: Record<string, unknown>;
      context: { supabase: never; userId: string };
    }) => Promise<Record<string, unknown>>;
    return fn({ data, context: ctx(db) });
  };

  it("returns INSUFFICIENT_CREDITS before any provider/debit/job call on preflight denial", async () => {
    mocks.preflightCreditsCheck.mockResolvedValueOnce({
      ok: false,
      code: "INSUFFICIENT_CREDITS",
      message: "Insufficient credits.",
      estimate: { credits: 5 },
    });
    const db = makeDb([]);
    const res = await call(db, { text: "hello world", selection });
    expect(res).toMatchObject({ ok: false, code: "INSUFFICIENT_CREDITS", fallbackCharacterId: null });
    expect(mocks.synthesizeSpeechWithFallback).not.toHaveBeenCalled();
    expect(mocks.debitMinutesForJob).not.toHaveBeenCalled();
    expect(mocks.storageUpload).not.toHaveBeenCalled();
  });

  it("returns VOICE_NOT_FOUND for an unknown character", async () => {
    const db = makeDb([]);
    const res = await call(db, { text: "hi", selection: { ...selection, characterId: "ghost" } });
    expect(res).toMatchObject({ ok: false, code: "VOICE_NOT_FOUND" });
    expect(mocks.synthesizeSpeechWithFallback).not.toHaveBeenCalled();
  });

  it("synthesizes, debits the preflight estimate, stores, and records the job", async () => {
    // mergedCharacter miss, job upsert (pending), job upsert (succeeded).
    const db = makeDb([ok(null), ok(null), ok(null)]);
    const res = await call(db, { text: "hello world", selection });
    expect(res).toMatchObject({
      ok: true,
      audioUrl: "https://cdn.test/preview.mp3",
      durationSeconds: 13,
      provider: "elevenlabs",
      model: "eleven_multilingual_v2",
      // 42 comes from the synthesizeSpeechWithFallback mock payload.
      characters: 42,
    });
    expect(typeof res["jobId"]).toBe("string");
    // Chain called with the character's own voice id.
    const [text, synthOpts] = mocks.synthesizeSpeechWithFallback.mock.calls[0] as unknown as [
      string,
      { voiceId: string; model: string },
    ];
    expect(text).toBe("hello world");
    expect(synthOpts.voiceId).toBe(ADAM_VOICE_ID);
    expect(synthOpts.model).toBe("eleven_multilingual_v2");
    // Debit used the preflight estimate (2 credits) against the job id.
    expect(mocks.debitMinutesForJob).toHaveBeenCalledTimes(1);
    const debitArgs = mocks.debitMinutesForJob.mock.calls[0] as unknown as unknown[];
    expect(debitArgs[1]).toBe("user-1");
    expect(debitArgs[2]).toBe(res["jobId"]);
    expect(debitArgs[3]).toBe(2);
    // Job ledger: pending → succeeded with the signed URL.
    const jobUpserts = db.calls.filter(
      (c) => c.table === "voice_generation_jobs" && c.method === "upsert",
    );
    expect(jobUpserts).toHaveLength(2);
    expect(jobUpserts[1]!.args[0]).toMatchObject({
      status: "succeeded",
      audio_url: "https://cdn.test/preview.mp3",
      character_id: "adam",
    });
  });

  it("maps a quota failure to TTS_QUOTA_EXHAUSTED and never debits", async () => {
    mocks.synthesizeSpeechWithFallback.mockResolvedValueOnce({
      ok: false,
      audio: null,
      provider: "elevenlabs",
      model: null,
      latencyMs: 10,
      characters: 11,
      unitCostUsd: null,
      error: { code: "elevenlabs_tts_failed", message: "quota exceeded (429)" },
    });
    const db = makeDb([ok(null), ok(null), ok(null)]);
    const res = await call(db, { text: "hello world", selection });
    expect(res).toMatchObject({ ok: false, code: "TTS_QUOTA_EXHAUSTED" });
    expect(mocks.debitMinutesForJob).not.toHaveBeenCalled();
    expect(mocks.storageUpload).not.toHaveBeenCalled();
    const jobUpserts = db.calls.filter(
      (c) => c.table === "voice_generation_jobs" && c.method === "upsert",
    );
    expect(jobUpserts[jobUpserts.length - 1]!.args[0]).toMatchObject({ status: "failed" });
  });
});

describe("estimateVoiceCost", () => {
  it("matches the pure cost.ts estimator exactly", async () => {
    const fn = estimateVoiceCost as unknown as (a: {
      data: { text: string; modelId?: string; languageCode?: string };
      context: { supabase: never; userId: string };
    }) => Promise<unknown>;
    const db = makeDb([]);
    const text = "Some stories change the way we see the world.";
    expect(
      await fn({ data: { text, modelId: "eleven_multilingual_v2", languageCode: "en" }, context: ctx(db) }),
    ).toEqual(pureEstimateVoiceCost(text, { modelId: "eleven_multilingual_v2", languageCode: "en" }));
    expect(await fn({ data: { text }, context: ctx(db) })).toEqual(pureEstimateVoiceCost(text, {}));
  });
});

/* ── handlers: favorites / defaults / profiles ─────────────────────────── */

describe("getVoiceFavorites / toggleVoiceFavorite", () => {
  const getCall = (db: { client: never }) => {
    const fn = getVoiceFavorites as unknown as (a: {
      context: { supabase: never; userId: string };
    }) => Promise<{ characterIds: string[] }>;
    return fn({ context: ctx(db) });
  };
  const toggleCall = (db: { client: never }, characterId: string) => {
    const fn = toggleVoiceFavorite as unknown as (a: {
      data: { characterId: string };
      context: { supabase: never; userId: string };
    }) => Promise<{ favorited: boolean }>;
    return fn({ data: { characterId }, context: ctx(db) });
  };

  it("lists favorite ids, newest first", async () => {
    const db = makeDb([ok([{ character_id: "adam" }, { character_id: "elli" }])]);
    expect(await getCall(db)).toEqual({ characterIds: ["adam", "elli"] });
  });

  it("returns [] when the table is missing", async () => {
    const db = makeDb([missingTable()]);
    expect(await getCall(db)).toEqual({ characterIds: [] });
  });

  it("toggles on when absent, off when present", async () => {
    const dbOn = makeDb([ok(null), ok({ character_id: "adam" })]);
    expect(await toggleCall(dbOn, "adam")).toEqual({ favorited: true });
    const insertCall = dbOn.calls.find(
      (c) => c.table === "user_voice_favorites" && c.method === "insert",
    );
    expect(insertCall!.args[0]).toMatchObject({ user_id: "user-1", character_id: "adam" });

    const dbOff = makeDb([ok({ character_id: "adam" }), ok(null)]);
    expect(await toggleCall(dbOff, "adam")).toEqual({ favorited: false });
    expect(
      dbOff.calls.some((c) => c.table === "user_voice_favorites" && c.method === "delete"),
    ).toBe(true);
  });

  it("rejects unknown character ids", async () => {
    const db = makeDb([]);
    await expect(toggleCall(db, "ghost")).rejects.toThrow("doesn't exist");
  });
});

describe("getChannelVoiceDefault / saveChannelVoiceDefault", () => {
  const selection = { languageCode: "en", characterId: "adam" };

  it("returns null when no default is saved (or table missing)", async () => {
    const fn = getChannelVoiceDefault as unknown as (a: {
      data: { scope: string };
      context: { supabase: never; userId: string };
    }) => Promise<{ selection: unknown | null }>;
    expect(
      await fn({ data: { scope: "channel:x" }, context: ctx(makeDb([ok(null)])) }),
    ).toEqual({ selection: null });
    expect(
      await fn({ data: { scope: "channel:x" }, context: ctx(makeDb([missingTable()])) }),
    ).toEqual({ selection: null });
  });

  it("upserts on (user_id, scope)", async () => {
    const fn = saveChannelVoiceDefault as unknown as (a: {
      data: { scope: string; selection: unknown };
      context: { supabase: never; userId: string };
    }) => Promise<{ ok: true }>;
    const db = makeDb([ok(null)]);
    expect(await fn({ data: { scope: "project:abc", selection }, context: ctx(db) })).toEqual({
      ok: true,
    });
    const upsert = db.calls.find((c) => c.table === "channel_voice_defaults" && c.method === "upsert");
    expect(upsert!.args[0]).toMatchObject({ user_id: "user-1", scope: "project:abc", selection });
    expect(upsert!.args[1]).toMatchObject({ onConflict: "user_id,scope" });
  });
});

describe("voice profiles", () => {
  const selection = { languageCode: "de", characterId: "elli" };

  it("lists profiles newest-first with createdAt mapping", async () => {
    const fn = listVoiceProfiles as unknown as (a: {
      context: { supabase: never; userId: string };
    }) => Promise<{ profiles: { id: string; name: string; createdAt: string }[] }>;
    const db = makeDb([
      ok([{ id: "p1", name: "Doc", selection, created_at: "2026-09-29T00:00:00Z" }]),
    ]);
    const res = await fn({ context: ctx(db) });
    expect(res.profiles).toEqual([
      { id: "p1", name: "Doc", selection, createdAt: "2026-09-29T00:00:00Z" },
    ]);
  });

  it("saves and deletes", async () => {
    const saveFn = saveVoiceProfile as unknown as (a: {
      data: { name: string; selection: unknown };
      context: { supabase: never; userId: string };
    }) => Promise<{ profile: { id: string; name: string } }>;
    const dbSave = makeDb([
      ok({ id: "p9", name: "Shorts", selection, created_at: "2026-09-29T00:00:00Z" }),
    ]);
    const saved = await saveFn({ data: { name: "  Shorts ", selection }, context: ctx(dbSave) });
    expect(saved.profile).toMatchObject({ id: "p9", name: "Shorts" });
    const insert = dbSave.calls.find((c) => c.table === "voice_profiles" && c.method === "insert");
    expect(insert!.args[0]).toMatchObject({ user_id: "user-1", name: "Shorts" });

    const delFn = deleteVoiceProfile as unknown as (a: {
      data: { id: string };
      context: { supabase: never; userId: string };
    }) => Promise<{ ok: true }>;
    const dbDel = makeDb([ok(null)]);
    expect(await delFn({ data: { id: "p9" }, context: ctx(dbDel) })).toEqual({ ok: true });
    const del = dbDel.calls.find((c) => c.table === "voice_profiles" && c.method === "delete");
    expect(del).toBeDefined();
  });
});

/* ── handlers: project config / analytics ──────────────────────────────── */

describe("project voice config", () => {
  const selection = { languageCode: "en", characterId: "adam" };

  it("gets the saved selection and throws for foreign projects", async () => {
    const fn = getProjectVoiceConfig as unknown as (a: {
      data: { projectId: string };
      context: { supabase: never; userId: string };
    }) => Promise<{ selection: unknown | null }>;
    const db = makeDb([ok({ id: "proj-1", voice_config: selection })]);
    expect(await fn({ data: { projectId: "proj-1" }, context: ctx(db) })).toEqual({ selection });

    const dbMissing = makeDb([ok(null)]);
    await expect(fn({ data: { projectId: "proj-x" }, context: ctx(dbMissing) })).rejects.toThrow(
      "Project not found",
    );
  });

  it("verifies ownership before writing", async () => {
    const fn = saveProjectVoiceConfig as unknown as (a: {
      data: { projectId: string; selection: unknown };
      context: { supabase: never; userId: string };
    }) => Promise<{ ok: true }>;
    const db = makeDb([ok({ id: "proj-1" }), ok(null)]);
    expect(await fn({ data: { projectId: "proj-1", selection }, context: ctx(db) })).toEqual({
      ok: true,
    });
    const update = db.calls.find((c) => c.table === "projects" && c.method === "update");
    expect(update!.args[0]).toEqual({ voice_config: selection });

    const dbForeign = makeDb([ok(null)]);
    await expect(
      fn({ data: { projectId: "proj-x", selection }, context: ctx(dbForeign) }),
    ).rejects.toThrow("Project not found");
    expect(
      dbForeign.calls.some((c) => c.table === "projects" && c.method === "update"),
    ).toBe(false);
  });
});

describe("trackVoiceEvent", () => {
  it("inserts the event and never throws — even when the insert blows up", async () => {
    const fn = trackVoiceEvent as unknown as (a: {
      data: { event: string; metadata?: Record<string, unknown> };
      context: { supabase: never; userId: string };
    }) => Promise<{ ok: true }>;
    const db = makeDb([ok({ id: "e1" })]);
    expect(await fn({ data: { event: "preview_played", metadata: { voice: "adam" } }, context: ctx(db) })).toEqual({
      ok: true,
    });
    const insert = db.calls.find((c) => c.table === "voice_analytics_events" && c.method === "insert");
    expect(insert!.args[0]).toMatchObject({ user_id: "user-1", event: "preview_played" });

    // A throwing client still resolves { ok: true }.
    const throwing = { from: () => { throw new Error("db down"); } } as never;
    expect(await fn({ data: { event: "x" }, context: { supabase: throwing, userId: "u" } })).toEqual({
      ok: true,
    });
  });
});
