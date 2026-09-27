/**
 * F17 Voice Studio — library logic tests (Stream D, Phase 3).
 *
 * Covers upload validation (MIME allowlist, size cap, magic bytes), the
 * cloning legal gate, builtin/user catalog merging, and voice→provider
 * routing. All pure — no DB, no network, no env.
 */
import { describe, expect, it } from "vitest";
import {
  validateVoiceUpload,
  assertCloneLegal,
  mergeVoiceCatalog,
  routeVoiceForTts,
  providerLabel,
} from "./library.server";
import { VOICE_UPLOAD_MAX_BYTES } from "./types";

const enc = (bytes: number[]) => new Uint8Array(bytes);

describe("validateVoiceUpload", () => {
  it("accepts a real MP3 (ID3 header)", () => {
    const r = validateVoiceUpload({
      declaredMime: "audio/mpeg",
      bytes: 1024,
      head: enc([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]),
    });
    expect(r).toEqual({ ok: true, mimeType: "audio/mpeg" });
  });

  it("accepts a real MP3 (frame sync)", () => {
    const r = validateVoiceUpload({
      declaredMime: "audio/mp3",
      bytes: 1024,
      head: enc([0xff, 0xfb, 0x90, 0x00]),
    });
    expect(r.ok).toBe(true);
  });

  it("accepts WAV (RIFF)", () => {
    const r = validateVoiceUpload({
      declaredMime: "audio/wav",
      bytes: 1024,
      head: enc([0x52, 0x49, 0x46, 0x46, 0x24, 0x00]),
    });
    expect(r.ok).toBe(true);
  });

  it("accepts OGG (OggS)", () => {
    const r = validateVoiceUpload({
      declaredMime: "audio/ogg",
      bytes: 1024,
      head: enc([0x4f, 0x67, 0x67, 0x53]),
    });
    expect(r.ok).toBe(true);
  });

  it("accepts M4A (ftyp box)", () => {
    const r = validateVoiceUpload({
      declaredMime: "audio/m4a",
      bytes: 1024,
      head: enc([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]),
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a non-audio MIME even with audio-looking bytes", () => {
    const r = validateVoiceUpload({
      declaredMime: "video/mp4",
      bytes: 1024,
      head: enc([0x49, 0x44, 0x33, 0x04]),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Unsupported audio type/);
  });

  it("rejects oversized uploads", () => {
    const r = validateVoiceUpload({
      declaredMime: "audio/mpeg",
      bytes: VOICE_UPLOAD_MAX_BYTES + 1,
      head: enc([0x49, 0x44, 0x33, 0x04]),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/25 MB/);
  });

  it("rejects magic-byte mismatches (mislabeled file)", () => {
    // Declared MP3 but the bytes are actually a PNG.
    const r = validateVoiceUpload({
      declaredMime: "audio/mpeg",
      bytes: 1024,
      head: enc([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/don't look like MPEG audio/);
  });

  it("rejects an unreadable header", () => {
    const r = validateVoiceUpload({ declaredMime: "audio/mpeg", bytes: 0, head: enc([]) });
    expect(r.ok).toBe(false);
  });
});

describe("assertCloneLegal", () => {
  it("blocks cloning without explicit confirmation (default false)", () => {
    const r = assertCloneLegal({ voiceType: "cloned", isCloneLegal: false });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(/explicit legal confirmation/);
  });

  it("blocks cloning when the flag is missing/null", () => {
    expect(assertCloneLegal({ voiceType: "cloned", isCloneLegal: null }).allowed).toBe(false);
    expect(assertCloneLegal({ voiceType: "cloned", isCloneLegal: undefined }).allowed).toBe(false);
  });

  it("allows cloning with explicit confirmation", () => {
    expect(assertCloneLegal({ voiceType: "cloned", isCloneLegal: true })).toEqual({
      allowed: true,
    });
  });

  it("does not gate non-clone voice types", () => {
    expect(assertCloneLegal({ voiceType: "uploaded", isCloneLegal: false }).allowed).toBe(true);
    expect(assertCloneLegal({ voiceType: "builtin", isCloneLegal: false }).allowed).toBe(true);
  });
});

describe("mergeVoiceCatalog", () => {
  it("marks builtins read-only and user rows editable", () => {
    const entries = mergeVoiceCatalog(
      [
        {
          id: "b1",
          name: "Rachel",
          provider: "elevenlabs",
          providerVoiceId: "21m00Tcm4TlvDq8ikWAM",
          voiceType: "builtin",
          languageCode: "en",
          verified: true,
        },
      ],
      [
        {
          id: "u1",
          name: "My Voice",
          provider: "upload",
          provider_voice_id: null,
          voice_type: "uploaded",
          language_code: "en",
          verified: false,
          is_clone_legal: false,
          metadata: { storage_path: "uid/voices/u1/sample.mp3" },
        },
      ],
    );
    expect(entries).toHaveLength(2);
    const builtin = entries.find((e) => e.id === "builtin:b1")!;
    const user = entries.find((e) => e.id === "u1")!;
    expect(builtin.readOnly).toBe(true);
    expect(user.readOnly).toBe(false);
    expect(user.storagePath).toBe("uid/voices/u1/sample.mp3");
  });

  it("coerces unknown provider/type strings to safe defaults", () => {
    const [entry] = mergeVoiceCatalog(
      [
        {
          id: "b9",
          name: "Odd",
          provider: "phantom",
          providerVoiceId: null,
          voiceType: "mystery",
          languageCode: null,
          verified: false,
        },
      ],
      [],
    );
    expect(entry!.provider).toBe("none");
    expect(entry!.voiceType).toBe("builtin");
  });
});

describe("routeVoiceForTts", () => {
  const base = {
    id: "u1",
    name: "V",
    providerVoiceId: "vid",
    voiceType: "builtin" as const,
    languageCode: "en",
    verified: true,
    isCloneLegal: false,
    readOnly: false,
    storagePath: null,
  };

  it("routes an ElevenLabs voice to elevenlabs first", () => {
    const r = routeVoiceForTts({ ...base, provider: "elevenlabs" });
    expect(r).toMatchObject({
      synthesizable: true,
      preferredProvider: "elevenlabs",
      voiceId: "vid",
    });
  });

  it("routes an OpenAI voice to openai", () => {
    const r = routeVoiceForTts({ ...base, provider: "openai", providerVoiceId: "nova" });
    expect(r).toMatchObject({ synthesizable: true, preferredProvider: "openai", voiceId: "nova" });
  });

  it("refuses to synthesize an uploaded sample", () => {
    const r = routeVoiceForTts({ ...base, provider: "upload", voiceType: "uploaded" });
    expect(r.synthesizable).toBe(false);
    if (!r.synthesizable) expect(r.reason).toMatch(/uploaded audio sample/);
  });

  it("blocks an unconfirmed clone even if a provider is set", () => {
    const r = routeVoiceForTts({
      ...base,
      provider: "elevenlabs",
      voiceType: "cloned",
      isCloneLegal: false,
    });
    expect(r.synthesizable).toBe(false);
    if (!r.synthesizable) expect(r.reason).toMatch(/without legal confirmation/);
  });

  it("allows a legally-confirmed clone through", () => {
    const r = routeVoiceForTts({
      ...base,
      provider: "elevenlabs",
      voiceType: "cloned",
      isCloneLegal: true,
    });
    expect(r.synthesizable).toBe(true);
  });

  it("rejects voices with no TTS provider", () => {
    const r = routeVoiceForTts({ ...base, provider: "none", providerVoiceId: null });
    expect(r.synthesizable).toBe(false);
  });
});

describe("providerLabel", () => {
  it("labels known ids and passes through unknowns", () => {
    expect(providerLabel("elevenlabs")).toBe("ElevenLabs");
    expect(providerLabel("openai")).toBe("OpenAI TTS");
    expect(providerLabel("weird")).toBe("weird");
  });
});
