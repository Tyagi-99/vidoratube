/**
 * Voice Intelligence — backend helpers (Stream B).
 *
 * SERVER-ONLY. Pure helpers plus the shared preview/resolution core used by
 * voice-intel.functions.ts. Kept in this module (instead of inline in the
 * functions file) so backend.test.ts can exercise the logic without the
 * createServerFn boundary.
 *
 * HONESTY: previews synthesize the resolved character's OWN provider voice
 * (ElevenLabs). They never fall through to another provider — a preview of
 * Adam that comes back in a different voice would be a silent substitution.
 */
import { createHash } from "node:crypto";
import { VOICE_CHARACTERS, VOICE_MODELS, voiceLanguage } from "./catalog";
import {
  availabilityOf,
  friendlyTtsError,
  resolveVoiceForSynthesis,
} from "./availability";
import { autoSelectModel } from "./models";
import type { PreviewErrorCode } from "./contracts";
import type {
  VoiceCategoryId,
  VoiceCharacter,
  VoiceCharacterStatus,
  VoiceModel,
} from "./types";
import type { TtsResult } from "../creation/voice/types";
import {
  isMissingTableError,
  type VoiceCharacterRow,
  type VoiceIntelClient,
  type VoiceModelRow,
} from "./db.server";

/* ── hashing ───────────────────────────────────────────────────────────── */

/** Deterministic preview cache key: sha256(characterId|modelId|text). */
export function previewCacheKey(
  characterId: string,
  modelId: string,
  text: string,
): string {
  return createHash("sha256")
    .update(`${characterId}|${modelId}|${text}`, "utf8")
    .digest("hex");
}

/** sha256 hex of arbitrary text (the `text_hash` column). */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/* ── error mapping ─────────────────────────────────────────────────────── */

/**
 * Map a provider TtsResult error to a user-facing PreviewErrorCode.
 * 401 (invalid/revoked key), 402/429 and quota language all map to
 * TTS_QUOTA_EXHAUSTED — the contract has no INVALID_KEY code, and the
 * friendly message tells the user to check plan usage / the key.
 */
export function mapTtsErrorToPreviewCode(
  error: { code: string; message: string } | null | undefined,
): PreviewErrorCode {
  const hay = `${error?.code ?? ""} ${error?.message ?? ""}`.toLowerCase();
  const quotaHints = [
    "401",
    "402",
    "429",
    "quota",
    "exceed",
    "rate limit",
    "unauthor",
    "invalid key",
    "invalid api key",
    "payment",
    "insufficient",
    "exhausted",
  ];
  if (quotaHints.some((h) => hay.includes(h))) return "TTS_QUOTA_EXHAUSTED";
  return "TTS_FAILED";
}

/* ── catalog ↔ DB merges ───────────────────────────────────────────────── */

/**
 * Merge catalog characters with `voice_characters` override rows.
 * DB `provider_voice_id` / `status` win when set (live operational state:
 * admin mappings, provider validation flips).
 */
export function mergeCharactersWithOverrides(
  catalog: VoiceCharacter[],
  rows: VoiceCharacterRow[],
): VoiceCharacter[] {
  if (rows.length === 0) return catalog;
  const byId = new Map(rows.map((r) => [r.id, r]));
  return catalog.map((c) => {
    const row = byId.get(c.id);
    if (!row) return c;
    return {
      ...c,
      providerVoiceId: row.provider_voice_id ?? c.providerVoiceId,
      status: (row.status as VoiceCharacterStatus) || c.status,
    };
  });
}

function modelRowToModel(row: VoiceModelRow): VoiceModel {
  return {
    id: row.id,
    provider: row.provider as VoiceModel["provider"],
    label: row.label,
    quality: row.quality as VoiceModel["quality"],
    speed: row.speed as VoiceModel["speed"],
    expressiveness: row.expressiveness as VoiceModel["expressiveness"],
    multilingual: row.multilingual,
    supportedLanguages: row.supported_languages,
    bestFor: row.best_for,
    costMultiplier: Number(row.cost_multiplier),
    supportedParams: row.supported_params as VoiceModel["supportedParams"],
    maturity: row.maturity as VoiceModel["maturity"],
    isActive: row.is_active,
  };
}

/**
 * Merge seed models with `voice_models` rows. The table is the live store
 * when present: seed rows are refreshed from it, and table-only rows (e.g.
 * newly discovered provider models) are appended.
 */
export function mergeModelsWithOverrides(
  seed: VoiceModel[],
  rows: VoiceModelRow[],
): VoiceModel[] {
  if (rows.length === 0) return seed;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const seedIds = new Set(seed.map((m) => m.id));
  const merged = seed.map((m) => {
    const row = byId.get(m.id);
    return row ? modelRowToModel(row) : m;
  });
  for (const row of rows) {
    if (!seedIds.has(row.id)) merged.push(modelRowToModel(row));
  }
  return merged;
}

/**
 * Conservative metadata for provider model ids with no curated entry.
 * Deliberately unflattering (no invented capabilities): alpha maturity,
 * no claimed languages or params, cost multiplier 1.
 */
export function conservativeModelMetadata(id: string, label: string): VoiceModel {
  return {
    id,
    provider: "elevenlabs",
    label,
    quality: 3,
    speed: "medium",
    expressiveness: "medium",
    multilingual: false,
    supportedLanguages: [],
    bestFor: "Provider model — capabilities not yet curated.",
    costMultiplier: 1,
    supportedParams: [],
    maturity: "alpha",
    isActive: true,
  };
}

/** Merge live provider model ids with curated metadata. */
export function mergeProviderModels(
  providerModels: { id: string; label: string }[],
  curated: VoiceModel[],
): VoiceModel[] {
  const byId = new Map(curated.map((m) => [m.id, m]));
  return providerModels.map(
    (p) => byId.get(p.id) ?? conservativeModelMetadata(p.id, p.label),
  );
}

/* ── DB reads (null when the migration isn't applied yet) ───────────────── */

export async function readCharacterOverrides(
  client: VoiceIntelClient,
): Promise<VoiceCharacterRow[] | null> {
  const { data, error } = await client.from("voice_characters").select("*");
  if (error) {
    if (isMissingTableError(error)) return null;
    throw new Error(error.message);
  }
  return data ?? [];
}

export async function readModelRows(
  client: VoiceIntelClient,
): Promise<VoiceModelRow[] | null> {
  const { data, error } = await client.from("voice_models").select("*");
  if (error) {
    if (isMissingTableError(error)) return null;
    throw new Error(error.message);
  }
  return data ?? [];
}

/** Catalog character with its DB overrides merged. Null for unknown ids. */
export async function mergedCharacter(
  client: VoiceIntelClient,
  characterId: string,
): Promise<VoiceCharacter | null> {
  const catalog = VOICE_CHARACTERS.find((c) => c.id === characterId);
  if (!catalog) return null;
  const { data, error } = await client
    .from("voice_characters")
    .select("provider_voice_id, status")
    .eq("id", characterId)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return catalog;
    throw new Error(error.message);
  }
  if (!data) return catalog;
  return {
    ...catalog,
    providerVoiceId: data.provider_voice_id ?? catalog.providerVoiceId,
    status: (data.status as VoiceCharacterStatus) || catalog.status,
  };
}

/* ── resolution / model selection / preview text ───────────────────────── */

export type CharacterResolution =
  | {
      ok: true;
      character: VoiceCharacter;
      viaFallback: boolean;
      fallbackNote: string | null;
    }
  | { ok: false; reason: string };

/**
 * Resolve a character id to something synthesizable, honoring DB overrides.
 * The fallback pick comes from the pure `resolveVoiceForSynthesis` (never
 * silent — `viaFallback` is always reported with the reason).
 */
export async function resolveCharacterForSynthesis(
  client: VoiceIntelClient,
  characterId: string,
  opts: { categoryId?: VoiceCategoryId | null; providerConfigured: boolean },
): Promise<CharacterResolution> {
  const merged = await mergedCharacter(client, characterId);
  if (!merged) return { ok: false, reason: "Unknown voice character." };
  const availability = availabilityOf(merged, opts.providerConfigured);
  if (availability === "ready" || (availability === "needs_key" && merged.providerVoiceId)) {
    return { ok: true, character: merged, viaFallback: false, fallbackNote: null };
  }
  const pure = resolveVoiceForSynthesis({
    characterId,
    categoryId: opts.categoryId ?? null,
    providerConfigured: opts.providerConfigured,
  });
  if (!pure.ok) return { ok: false, reason: pure.reason };
  if (!pure.viaFallback) {
    // Unreachable in practice: this path is only taken when the requested
    // character isn't directly synthesizable, so the pure resolver always
    // returns a fallback here. The check satisfies the union type.
    return { ok: true, character: pure.character, viaFallback: false, fallbackNote: null };
  }
  // The fallback pick is a catalog character — merge its DB overrides too.
  const fallbackMerged = (await mergedCharacter(client, pure.character.id)) ?? pure.character;
  return {
    ok: true,
    character: fallbackMerged,
    viaFallback: true,
    fallbackNote: pure.reason,
  };
}

/**
 * Effective model id for a synthesis: an explicit, active model id wins;
 * "auto", missing, or unknown ids fall back to the auto model selection.
 */
export function resolveModelId(
  character: VoiceCharacter,
  text: string,
  modelId?: string | null,
  categoryId?: VoiceCategoryId | null,
): string {
  if (modelId && modelId !== "auto") {
    const known = VOICE_MODELS.find((m) => m.id === modelId && m.isActive);
    if (known) return known.id;
  }
  const langCharsPerMinute = voiceLanguage(character.languageCode)?.charsPerMinute ?? 800;
  const durationSeconds = Math.max(1, (text.length / langCharsPerMinute) * 60);
  return autoSelectModel({
    durationSeconds,
    categoryId: categoryId ?? character.categoryTags[0] ?? null,
    languageCode: character.languageCode,
  }).model.id;
}

/** Default preview text: the character language's catalog sample. */
export function defaultPreviewText(character: VoiceCharacter): string {
  const sample = voiceLanguage(character.languageCode)?.previewSample?.trim();
  return sample && sample.length > 0
    ? sample
    : "This is a preview of how this voice sounds.";
}

/* ── preview core ──────────────────────────────────────────────────────── */

export type PreviewAttempt =
  | {
      ok: true;
      audioUrl: string;
      cached: boolean;
      character: VoiceCharacter;
      viaFallback: boolean;
      fallbackNote: string | null;
    }
  | { ok: false; code: PreviewErrorCode; message: string };

async function readPreviewCache(
  db: VoiceIntelClient,
  userId: string,
  cacheKey: string,
): Promise<string | null> {
  try {
    const { data, error } = await db
      .from("generated_voice_previews")
      .select("audio_url")
      .eq("user_id", userId)
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (error) return null; // missing table → cache miss, synthesize fresh
    return data?.audio_url ?? null;
  } catch {
    return null;
  }
}

async function writePreviewCache(
  db: VoiceIntelClient,
  row: {
    userId: string;
    cacheKey: string;
    characterId: string;
    modelId: string;
    text: string;
    audioUrl: string;
  },
): Promise<void> {
  try {
    await db.from("generated_voice_previews").insert({
      user_id: row.userId,
      cache_key: row.cacheKey,
      character_id: row.characterId,
      model_id: row.modelId,
      text_hash: sha256Hex(row.text),
      audio_url: row.audioUrl,
    });
  } catch {
    // Best-effort: the signed URL is still returned to the caller.
  }
}

/**
 * Full preview pipeline for one character: resolve (fallback-aware) →
 * provider gate → cache → synthesize → store → cache. Provider calls and
 * storage are injected so tests can drive this without network.
 */
export async function runVoicePreview(opts: {
  db: VoiceIntelClient;
  userId: string;
  characterId: string;
  text?: string | undefined;
  modelId?: string | undefined;
  elevenLabsConfigured: boolean;
  synthesize: (
    text: string,
    synthOpts: { voiceId: string; model: string },
  ) => Promise<TtsResult>;
  uploadAudio: (path: string, audio: ArrayBuffer) => Promise<void>;
  signAudioUrl: (path: string) => Promise<string>;
}): Promise<PreviewAttempt> {
  const resolution = await resolveCharacterForSynthesis(opts.db, opts.characterId, {
    providerConfigured: opts.elevenLabsConfigured,
  });
  if (!resolution.ok) {
    const unknown = resolution.reason === "Unknown voice character.";
    return {
      ok: false,
      code: "UNMAPPED_VOICE",
      // Unknown ids get the not-found message (the code enum has no
      // VOICE_NOT_FOUND member); unmapped-with-no-fallback gets the
      // unmapped message.
      message: unknown
        ? friendlyTtsError("VOICE_NOT_FOUND")
        : friendlyTtsError("UNMAPPED_VOICE"),
    };
  }
  const { character, viaFallback, fallbackNote } = resolution;

  // The gate is on the character's own provider: a preview must be THIS
  // voice, so a configured-but-different provider doesn't help.
  if (!opts.elevenLabsConfigured || !character.providerVoiceId) {
    return {
      ok: false,
      code: "NO_TTS_PROVIDER",
      message: friendlyTtsError("NO_TTS_PROVIDER"),
    };
  }

  const text = opts.text?.trim() || defaultPreviewText(character);
  const modelId = resolveModelId(character, text, opts.modelId);
  const cacheKey = previewCacheKey(character.id, modelId, text);

  const cachedUrl = await readPreviewCache(opts.db, opts.userId, cacheKey);
  if (cachedUrl) {
    return { ok: true, audioUrl: cachedUrl, cached: true, character, viaFallback, fallbackNote };
  }

  const result = await opts.synthesize(text, {
    voiceId: character.providerVoiceId,
    model: modelId,
  });
  if (!result.ok || !result.audio) {
    const code = mapTtsErrorToPreviewCode(result.error);
    return { ok: false, code, message: friendlyTtsError(code) };
  }

  try {
    const path = `${opts.userId}/voice-previews/${cacheKey}.mp3`;
    await opts.uploadAudio(path, result.audio);
    const audioUrl = await opts.signAudioUrl(path);
    await writePreviewCache(opts.db, {
      userId: opts.userId,
      cacheKey,
      characterId: character.id,
      modelId,
      text,
      audioUrl,
    });
    return { ok: true, audioUrl, cached: false, character, viaFallback, fallbackNote };
  } catch {
    return { ok: false, code: "TTS_FAILED", message: friendlyTtsError("TTS_FAILED") };
  }
}
