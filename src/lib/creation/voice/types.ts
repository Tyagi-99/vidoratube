/**
 * F17 Voice Studio — shared types (Stream D, Phase 3).
 *
 * EXTENDS the existing voiceover mode (Mode 2 dialog + language_voices
 * catalog); it does not replace it. Multi-provider TTS goes through the
 * ordered fallback chain in chain.server.ts (ElevenLabs primary, OpenAI TTS
 * fallback); the voice library CRUD lives in voice.functions.ts against the
 * `voices` table (Phase-1 migration 20260928020100_p1_creation.sql).
 */
import { z } from "zod";

/** TTS providers a voice row can route to. Mirrors the `voices.provider` CHECK. */
export const VOICE_PROVIDER_IDS = ["elevenlabs", "openai", "gateway", "upload", "none"] as const;
export type VoiceProviderId = (typeof VOICE_PROVIDER_IDS)[number];

export const VOICE_TYPES = ["builtin", "uploaded", "cloned"] as const;
export type VoiceType = (typeof VOICE_TYPES)[number];

/** A registered TTS adapter in the fallback chain. */
export type TtsProvider = {
  id: VoiceProviderId;
  label: string;
  /** Env-key based; false means "not configured" — never a network call. */
  configured(): boolean;
  /**
   * Synthesize one chunk of text. MUST return the ProviderResult envelope,
   * never throw — the chain converts exceptions to error envelopes.
   */
  synthesize(
    text: string,
    opts: { voiceId: string; model: string; speed?: number },
  ): Promise<TtsResult>;
};

export type TtsResult = {
  ok: boolean;
  audio: ArrayBuffer | null;
  provider: string;
  model: string | null;
  latencyMs: number;
  /** Billable characters measured from the input text. */
  characters: number;
  /** USD per character actually applied (list-price or passthrough estimate). */
  unitCostUsd: number | null;
  error: { code: string; message: string } | null;
};

/** One voice the studio can pick: builtin catalog slots are read-only. */
export type VoiceLibraryEntry = {
  /** `voices` row id for user voices; `language_voices` id for builtins. */
  id: string;
  name: string;
  provider: VoiceProviderId;
  providerVoiceId: string | null;
  voiceType: VoiceType;
  languageCode: string | null;
  verified: boolean;
  isCloneLegal: boolean;
  /** Builtin catalog rows cannot be edited/deleted — they are reference data. */
  readOnly: boolean;
  storagePath: string | null;
};

/** Input for creating a user voice row. Server validates the legal gate. */
export const CreateUserVoiceSchema = z.object({
  name: z.string().min(1).max(80),
  provider: z.enum(VOICE_PROVIDER_IDS),
  providerVoiceId: z.string().max(200).nullable().default(null),
  voiceType: z.enum(VOICE_TYPES).default("builtin"),
  languageCode: z.string().max(16).nullable().default(null),
  /** Required when voiceType === 'cloned' (D37 rule). */
  isCloneLegal: z.boolean().default(false),
  /** Storage path of the uploaded sample (voiceType === 'uploaded'). */
  storagePath: z.string().max(500).nullable().default(null),
  /** Declared by the client; the server re-validates against the object. */
  sampleMimeType: z.string().max(100).nullable().default(null),
  sampleBytes: z.number().int().positive().nullable().default(null),
});
export type CreateUserVoiceInput = z.infer<typeof CreateUserVoiceSchema>;

/** Voice upload constraints. */
export const VOICE_UPLOAD_MAX_BYTES = 25 * 1024 * 1024; // 25 MB
export const VOICE_UPLOAD_ALLOWED_MIME = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/ogg",
  "audio/webm",
  "audio/mp4",
  "audio/m4a",
] as const;
export type VoiceUploadMime = (typeof VOICE_UPLOAD_ALLOWED_MIME)[number];

/** Text→speech job request. */
export const VoiceoverJobSchema = z.object({
  voiceId: z.string().min(1),
  text: z.string().min(1).max(4000),
  workspaceId: z.string().uuid().nullable().default(null),
  projectId: z.string().uuid().nullable().default(null),
  /** Optional client-supplied idempotency key for safe retries. */
  idempotencyKey: z.string().max(128).nullable().default(null),
});
export type VoiceoverJobInput = z.infer<typeof VoiceoverJobSchema>;

export type VoiceoverJobResult =
  | {
      ok: true;
      jobId: string;
      audioUrl: string;
      durationSeconds: number;
      provider: string;
      model: string | null;
      characters: number;
    }
  | {
      ok: false;
      /** Machine-readable gate code for the UI (mirrors preflight codes). */
      code:
        | "INSUFFICIENT_CREDITS"
        | "BUDGET_EXCEEDED"
        | "UNKNOWN_COST"
        | "TTS_FAILED"
        | "VOICE_NOT_FOUND"
        | "VOICE_NOT_SYNTHESIZABLE"
        | "NO_TTS_PROVIDER"
        | "JOB_IN_PROGRESS";
      message: string;
    };
