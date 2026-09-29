/**
 * Voice Intelligence — availability + fallback resolution (D327).
 *
 * A character is synthesizable only when it has a providerVoiceId AND the
 * provider is reachable. Unmapped characters NEVER fail silently: the
 * resolver returns an explicit fallback (same language, shared category,
 * highest score) or a hard failure the UI must surface with a clear action.
 */
import { VOICE_CHARACTERS } from "./catalog";
import type { VoiceCategoryId, VoiceCharacter, VoiceResolution } from "./types";

/** Display state for a voice card / picker row. */
export type VoiceAvailability =
  | "ready" // mapped/verified — can synthesize (provider reachability checked server-side)
  | "needs_key" // mapped but no provider key configured
  | "unmapped" // curated persona, no provider voice assigned yet
  | "legacy" // provider id no longer resolves
  | "unavailable"; // provider reports the voice unavailable

export function availabilityOf(
  character: VoiceCharacter,
  providerConfigured: boolean,
): VoiceAvailability {
  if (character.status === "legacy") return "legacy";
  if (character.status === "unavailable") return "unavailable";
  if (!character.providerVoiceId || character.status === "unmapped") return "unmapped";
  if (!providerConfigured) return "needs_key";
  return "ready";
}

export function availabilityLabel(a: VoiceAvailability): string {
  switch (a) {
    case "ready": return "Ready";
    case "needs_key": return "Needs provider key";
    case "unmapped": return "Not connected yet";
    case "legacy": return "Legacy — needs remapping";
    case "unavailable": return "Unavailable";
  }
}

export interface ResolveInput {
  characterId: string;
  /** Category context improves the fallback pick. */
  categoryId?: VoiceCategoryId | null;
  providerConfigured: boolean;
}

/**
 * Resolve a character to something the TTS chain can actually synthesize.
 * Unmapped/legacy voices fall back to the best compatible alternative —
 * always reported via `viaFallback`, never silent.
 */
export function resolveVoiceForSynthesis(input: ResolveInput): VoiceResolution {
  const { characterId, categoryId = null, providerConfigured } = input;
  const requested = VOICE_CHARACTERS.find((c) => c.id === characterId);
  if (!requested) {
    return { ok: false, requestedId: characterId, reason: "Unknown voice character." };
  }
  const availability = availabilityOf(requested, providerConfigured);
  if (availability === "ready" || (availability === "needs_key" && requested.providerVoiceId)) {
    return { ok: true, character: requested, viaFallback: false };
  }

  const fallback = bestFallback(requested, categoryId);
  if (!fallback) {
    return {
      ok: false,
      requestedId: characterId,
      reason:
        `${requested.name} isn't connected to a provider voice yet, and no compatible ${requested.languageCode} voice is available.`,
    };
  }
  return {
    ok: true,
    character: fallback,
    viaFallback: true,
    requestedId: characterId,
    reason: `${requested.name} isn't connected to a provider voice yet — using ${fallback.name} instead.`,
  };
}

/**
 * Picks the best same-language mapped fallback for an unmapped voice.
 * Exported for tests: pass `candidates` to exercise the mechanism with
 * synthetic data — production always uses the live catalog.
 */
export function bestFallback(
  requested: VoiceCharacter,
  categoryId: VoiceCategoryId | null,
  candidates: VoiceCharacter[] = VOICE_CHARACTERS,
): VoiceCharacter | null {
  const pool = candidates.filter(
    (c) =>
      c.id !== requested.id &&
      c.languageCode === requested.languageCode &&
      c.providerVoiceId &&
      c.status !== "legacy" &&
      c.status !== "unavailable",
  );
  if (pool.length === 0) return null;
  const scored = pool.map((c) => {
    let s = c.score;
    if (categoryId && c.categoryTags.includes(categoryId)) s += 2;
    const shared = c.categoryTags.filter((t) => requested.categoryTags.includes(t)).length;
    s += shared * 0.5;
    if (c.isDefault) s += 0.25;
    return { c, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored[0]!.c;
}

/** Friendly, non-technical error copy for TTS failures (never raw codes). */
export function friendlyTtsError(code: string): string {
  switch (code) {
    case "UNMAPPED_VOICE":
      return "This voice isn't connected to a narration provider yet. Pick the suggested alternative or choose another voice.";
    case "NO_TTS_PROVIDER":
      return "No narration provider is connected. Add an ElevenLabs API key in Settings → Providers to enable voice generation.";
    case "TTS_QUOTA_EXHAUSTED":
      return "Your ElevenLabs voice quota appears to be exhausted. Check your plan usage or try again later.";
    case "TTS_FAILED":
      return "We couldn't generate this voice preview. Try another model or retry.";
    case "VOICE_NOT_FOUND":
      return "That voice couldn't be found. It may have been removed — please pick another.";
    default:
      return "Something went wrong generating audio. Please retry.";
  }
}
