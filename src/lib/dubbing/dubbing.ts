/**
 * Dubbing (localize a finished video) — Sprint 5-6.
 *
 * Pipeline (per target language):
 *   1. Validate the language code against the `languages` table rows —
 *      unknown codes are an explicit error, never a silent fallback.
 *   2. Pick a VERIFIED voice for that language (mirror of
 *      `language_voices.verified`). No verified voice => explicit error or
 *      a clearly-labeled stub when the caller opts in; never a silent
 *      substitution of another language's voice.
 *   3. Re-synthesize the narration in the target language via the existing
 *      ElevenLabs/gateway TTS path (the worker does this; this module
 *      produces the plan the worker executes).
 *   4. Replace the narration stem, keep music/SFX stems untouched.
 *   5. Re-time/re-wrap captions with that language's `caption_max_chars`
 *      (see buildWordAss in src/lib/render/shared.ts — the worker calls it
 *      with the resolved language row).
 *   6. Write a NEW renders row linked to the source via `parent_id`.
 *
 * Beta honesty: dubbing into a 'beta' language is allowed, but every UI
 * surface labels the result "Beta" (see betaLabel).
 *
 * Language-neutral by design: all language behaviour comes from the
 * `languages` table rows passed in — this module never branches on a
 * hardcoded language code or name.
 */

import { VOICE_CATALOG, type CatalogVoice } from "../voices";
import { renderCreditCost } from "../billing/per-minute";

/** Minimal shape of one `languages` table row. */
export interface LanguageRow {
  code: string;
  nameEn: string;
  nameNative: string;
  status: "live" | "beta" | "planned";
  captionMaxChars: number;
  rtl: boolean;
  fontStack: string;
}

/** Minimal shape of one `language_voices` table row. */
export interface LanguageVoiceSlot {
  languageCode: string;
  name: string;
  provider: "elevenlabs" | "gateway" | "none";
  providerVoiceId: string | null;
  verified: boolean;
  selectable: boolean;
}

export type DubErrorCode = "unknown-language" | "no-verified-voice" | "language-not-releasable";

export class DubError extends Error {
  code: DubErrorCode;
  constructor(code: DubErrorCode, message: string) {
    super(message);
    this.name = "DubError";
    this.code = code;
  }
}

/**
 * Resolve a target language code against the languages table.
 * Unknown codes are an explicit error — never silently map to another language.
 * 'planned' languages cannot be dubbed yet (no behaviour rows).
 */
export function resolveDubLanguage(code: string, languages: LanguageRow[]): LanguageRow {
  const row = languages.find((l) => l.code === code);
  if (!row) {
    throw new DubError(
      "unknown-language",
      `Unknown language code "${code}". Dubbing needs a code from the languages table.`,
    );
  }
  if (row.status === "planned") {
    throw new DubError(
      "language-not-releasable",
      `"${row.nameEn}" is not available for dubbing yet.`,
    );
  }
  return row;
}

/**
 * The honest beta marker. "Beta" for beta languages, empty for live.
 * Every UI surface showing a dub target must render this next to the name.
 */
export function betaLabel(status: LanguageRow["status"]): string {
  return status === "beta" ? "Beta" : "";
}

export interface DubVoice {
  catalogId: string | null;
  name: string;
  provider: "elevenlabs" | "gateway";
  providerVoiceId: string;
  verified: boolean;
  /** True only when the caller explicitly accepted a placeholder. */
  stub: boolean;
}

/**
 * Pick the voice for a dub. Uses ONLY verified voices for the target
 * language: first by catalog order among entries that are verified, have a
 * concrete provider id, and match the language code.
 *
 * With no verified voice this throws an explicit error that names the
 * language — it never silently substitutes a voice from another language.
 * Pass { allowStub: true } to get a clearly-labeled stub instead (the stub
 * is marked stub: true and "Beta" by the UI; the worker must not render it).
 */
export function selectDubVoice(
  languageCode: string,
  opts: {
    catalog?: CatalogVoice[];
    voiceSlots?: LanguageVoiceSlot[];
    allowStub?: boolean;
  } = {},
): DubVoice {
  const catalog = opts.catalog ?? VOICE_CATALOG;
  const candidate = catalog.find(
    (v) =>
      v.languageCode === languageCode &&
      v.verified === true &&
      v.providerVoiceId !== null &&
      (v.provider === "elevenlabs" || v.provider === "gateway"),
  );
  if (candidate?.providerVoiceId) {
    return {
      catalogId: candidate.id,
      name: candidate.name,
      provider: candidate.provider,
      providerVoiceId: candidate.providerVoiceId,
      verified: true,
      stub: false,
    };
  }
  // Cross-check the language_voices slots: a slot verified in the DB counts
  // as verified even if the in-code catalog lags behind.
  const slot = (opts.voiceSlots ?? []).find(
    (s) =>
      s.languageCode === languageCode &&
      s.verified &&
      s.providerVoiceId !== null &&
      s.provider !== "none",
  );
  if (slot && slot.providerVoiceId && slot.provider !== "none") {
    return {
      catalogId: null,
      name: slot.name,
      provider: slot.provider,
      providerVoiceId: slot.providerVoiceId,
      verified: true,
      stub: false,
    };
  }
  if (opts.allowStub) {
    return {
      catalogId: null,
      name: `${languageCode} voice (pending verification)`,
      provider: "elevenlabs",
      providerVoiceId: "",
      verified: false,
      stub: true,
    };
  }
  throw new DubError(
    "no-verified-voice",
    `No verified voice for language "${languageCode}" yet. ` +
      `A voice id must be verified against a real provider before dubbing ` +
      `can use it — see docs/FOUNDER_TODO.md (voice verification).`,
  );
}

export interface DubSource {
  id: string;
  projectId: string;
  durationSeconds: number;
  aspectRatio: string;
  resolution: string;
  /** Existing caption cues to re-time/re-wrap in the target language. */
  captionCueCount: number;
}

export interface DubPlan {
  language: LanguageRow;
  voice: DubVoice;
  /** True when the result must be labeled Beta in the UI. */
  isBeta: boolean;
  /** Exact credits this dub costs (0.5 per finished minute). */
  credits: number;
  /** The renders-row insert the worker/enqueue path writes (parent-linked). */
  renderInsert: {
    type: "full";
    engine: "server_ffmpeg";
    format: "mp4";
    status: "queued";
    stage: "queued";
    progress: 0;
    aspect_ratio: string;
    resolution: string;
    duration: number;
    parent_id: string;
    meta: Record<string, unknown>;
  };
}

/**
 * Build the full dub plan for one target language: validated language,
 * verified voice, exact credit cost, and the parent-linked renders insert.
 * Pure — the server enqueue path calls this, then reserves the credits.
 */
export function planDubRender(
  source: DubSource,
  targetCode: string,
  languages: LanguageRow[],
  opts: { voiceSlots?: LanguageVoiceSlot[]; allowStub?: boolean } = {},
): DubPlan {
  const language = resolveDubLanguage(targetCode, languages);
  const voice = selectDubVoice(targetCode, opts);
  const credits = renderCreditCost({
    durationSeconds: source.durationSeconds,
    mode: "story",
    dubLanguages: 1,
  }).dubbingCredits;
  return {
    language,
    voice,
    isBeta: language.status === "beta",
    credits,
    renderInsert: {
      type: "full",
      engine: "server_ffmpeg",
      format: "mp4",
      status: "queued",
      stage: "queued",
      progress: 0,
      aspect_ratio: source.aspectRatio,
      resolution: source.resolution,
      duration: source.durationSeconds,
      parent_id: source.id,
      meta: {
        kind: "dub",
        dub_of: source.id,
        project_id: source.projectId,
        language: language.code,
        language_status: language.status,
        beta: language.status === "beta",
        voice_id: voice.catalogId,
        voice_name: voice.name,
        provider_voice_id: voice.providerVoiceId,
        verified_voice: voice.verified,
        stub: voice.stub,
        caption_max_chars: language.captionMaxChars,
        rtl: language.rtl,
        caption_cue_count: source.captionCueCount,
        // Stem policy: narration is re-synthesized and replaced;
        // music and SFX stems are carried over untouched.
        stems: { narration: "replace", music: "keep", sfx: "keep" },
      },
    },
  };
}

/** Quote N dub languages over one finished video (0.5 credits/min/language). */
export function quoteDubbing(
  durationSeconds: number,
  languageCount: number,
): { minutes: number; credits: number } {
  const cost = renderCreditCost({
    durationSeconds,
    mode: "story",
    dubLanguages: Math.max(0, Math.floor(languageCount)),
  });
  return { minutes: cost.minutes, credits: cost.dubbingCredits };
}
