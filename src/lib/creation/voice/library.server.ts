/**
 * F17 Voice Studio — pure library logic (Stream D, Phase 3).
 *
 * No DB, no network, no env reads — every function here is unit-testable.
 * Server fns (voice.functions.ts) call these before touching providers or
 * storage; UI mirrors the same rules for instant feedback.
 */
import type { VoiceLibraryEntry, VoiceProviderId, VoiceType } from "./types";
import { VOICE_UPLOAD_MAX_BYTES, VOICE_UPLOAD_ALLOWED_MIME } from "./types";

/** Re-exported so client upload UIs can validate early. */
export { VOICE_UPLOAD_MAX_BYTES, VOICE_UPLOAD_ALLOWED_MIME };

/* ── voice upload validation ─────────────────────────────────────────── */

/** Magic-byte signatures matched per declared MIME type. */
const AUDIO_MAGIC: { mime: string; check: (b: Uint8Array) => boolean }[] = [
  {
    mime: "audio/mpeg",
    check: (b) =>
      // ID3v2 header or MPEG frame sync
      (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) ||
      (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0),
  },
  {
    mime: "audio/mp3",
    check: (b) =>
      (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) ||
      (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0),
  },
  {
    mime: "audio/wav",
    check: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46, // RIFF
  },
  {
    mime: "audio/x-wav",
    check: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46,
  },
  {
    mime: "audio/wave",
    check: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46,
  },
  {
    mime: "audio/ogg",
    check: (b) => b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53, // OggS
  },
  {
    mime: "audio/webm",
    check: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3, // EBML
  },
  {
    mime: "audio/mp4",
    check: (b) =>
      b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70, // ....ftyp
  },
  {
    mime: "audio/m4a",
    check: (b) =>
      b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70,
  },
];

export type VoiceUploadValidation = { ok: true; mimeType: string } | { ok: false; reason: string };

/**
 * Validate a voice sample upload: MIME allowlist, size cap, and magic bytes
 * matching the declared container. Never trusts the client-declared type
 * alone — the head bytes must look like audio.
 */
export function validateVoiceUpload(input: {
  declaredMime: string;
  bytes: number;
  head: Uint8Array;
}): VoiceUploadValidation {
  const mime = (input.declaredMime || "").toLowerCase().split(";")[0]!.trim();
  if (!(VOICE_UPLOAD_ALLOWED_MIME as readonly string[]).includes(mime)) {
    return {
      ok: false,
      reason:
        `Unsupported audio type "${input.declaredMime}". ` + `Use MP3, WAV, OGG, WebM, or M4A.`,
    };
  }
  if (input.bytes > VOICE_UPLOAD_MAX_BYTES) {
    return {
      ok: false,
      reason: `Audio is ${(input.bytes / 1024 / 1024).toFixed(1)} MB — the voice-sample limit is 25 MB.`,
    };
  }
  if (input.head.length < 4) {
    return { ok: false, reason: "Could not read the audio file's header." };
  }
  const rule = AUDIO_MAGIC.find((r) => r.mime === mime);
  if (rule && !rule.check(input.head)) {
    return {
      ok: false,
      reason:
        `The file's contents don't look like ${mime.split("/")[1]?.toUpperCase()} audio. ` +
        `Check the file isn't corrupt or mislabeled.`,
    };
  }
  return { ok: true, mimeType: mime };
}

/* ── voice cloning legal gate ────────────────────────────────────────── */

export type CloneGate = { allowed: true } | { allowed: false; reason: string };

/**
 * Cloning is ONLY allowed with an explicit legal confirmation (the
 * `is_clone_legal` checkbox, default false). The server re-checks this
 * unconditionally — a client flag alone never authorizes a clone.
 */
export function assertCloneLegal(input: {
  voiceType: VoiceType;
  isCloneLegal: boolean | null | undefined;
}): CloneGate {
  if (input.voiceType !== "cloned") return { allowed: true };
  if (input.isCloneLegal === true) return { allowed: true };
  return {
    allowed: false,
    reason:
      "Voice cloning requires your explicit legal confirmation that you have the right " +
      "to clone this voice. Check the confirmation box to continue.",
  };
}

/* ── catalog merge: builtin (read-only) + user voices ─────────────────── */

export type BuiltinVoiceRow = {
  id: string;
  name: string;
  provider: string;
  providerVoiceId: string | null;
  voiceType: string;
  languageCode: string | null;
  verified: boolean;
};

export type UserVoiceRow = {
  id: string;
  name: string;
  provider: string;
  provider_voice_id: string | null;
  voice_type: string;
  language_code: string | null;
  verified: boolean;
  is_clone_legal: boolean;
  metadata: { storage_path?: string } | null;
};

function asProviderId(p: string): VoiceProviderId {
  return (["elevenlabs", "openai", "gateway", "upload", "none"] as const).includes(
    p as VoiceProviderId,
  )
    ? (p as VoiceProviderId)
    : "none";
}

function asVoiceType(t: string): VoiceType {
  return (["builtin", "uploaded", "cloned"] as const).includes(t as VoiceType)
    ? (t as VoiceType)
    : "builtin";
}

/**
 * Merge the shared `language_voices` catalog (read-only reference data) with
 * the caller's `voices` rows. Builtins are never editable — CRUD targets only
 * user rows.
 */
export function mergeVoiceCatalog(
  builtin: BuiltinVoiceRow[],
  user: UserVoiceRow[],
): VoiceLibraryEntry[] {
  const entries: VoiceLibraryEntry[] = [
    ...builtin.map((b) => ({
      id: `builtin:${b.id}`,
      name: b.name,
      provider: asProviderId(b.provider),
      providerVoiceId: b.providerVoiceId,
      voiceType: asVoiceType(b.voiceType),
      languageCode: b.languageCode,
      verified: b.verified,
      isCloneLegal: false,
      readOnly: true,
      storagePath: null as string | null,
    })),
    ...user.map((u) => ({
      id: u.id,
      name: u.name,
      provider: asProviderId(u.provider),
      providerVoiceId: u.provider_voice_id,
      voiceType: asVoiceType(u.voice_type),
      languageCode: u.language_code,
      verified: u.verified,
      isCloneLegal: u.is_clone_legal,
      readOnly: false,
      storagePath: u.metadata?.storage_path ?? null,
    })),
  ];
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

/* ── voice → provider routing ────────────────────────────────────────── */

export type TtsRoute =
  | {
      synthesizable: true;
      /** First provider to try; the chain still falls back below it. */
      preferredProvider: "elevenlabs" | "openai" | "gateway";
      voiceId: string;
      model: string;
    }
  | { synthesizable: false; reason: string };

/**
 * Decide how a library entry is synthesized. Uploaded voices are raw audio
 * samples (reference for cloning / direct use) — they cannot be TTS'd.
 * Cloned voices route to the provider that hosts the clone.
 */
export function routeVoiceForTts(entry: VoiceLibraryEntry): TtsRoute {
  if (entry.voiceType === "uploaded") {
    return {
      synthesizable: false,
      reason:
        `"${entry.name}" is an uploaded audio sample, not a TTS voice. ` +
        `Use it as narration reference or pick a synthesizable voice.`,
    };
  }
  if (entry.voiceType === "cloned" && !entry.isCloneLegal) {
    return {
      synthesizable: false,
      reason: `"${entry.name}" is a clone without legal confirmation — synthesis is blocked.`,
    };
  }
  if (entry.provider === "elevenlabs" && entry.providerVoiceId) {
    return {
      synthesizable: true,
      preferredProvider: "elevenlabs",
      voiceId: entry.providerVoiceId,
      model: "eleven_v4",
    };
  }
  if (entry.provider === "openai") {
    return {
      synthesizable: true,
      preferredProvider: "openai",
      voiceId: entry.providerVoiceId ?? "alloy",
      model: "gpt-4o-mini-tts",
    };
  }
  if (entry.provider === "gateway") {
    return {
      synthesizable: true,
      preferredProvider: "gateway",
      voiceId: entry.providerVoiceId ?? "alloy",
      model: "openai/gpt-4o-mini-tts",
    };
  }
  return {
    synthesizable: false,
    reason: `"${entry.name}" has no configured TTS provider (provider: ${entry.provider}).`,
  };
}

/* ── provider display facts ──────────────────────────────────────────── */

export const TTS_PROVIDER_LABELS: Record<string, string> = {
  elevenlabs: "ElevenLabs",
  openai: "OpenAI TTS",
  gateway: "Lovable AI gateway",
  upload: "Uploaded sample",
  none: "Not connected",
};

export function providerLabel(id: string): string {
  return TTS_PROVIDER_LABELS[id] ?? id;
}
