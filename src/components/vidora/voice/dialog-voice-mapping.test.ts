import { describe, expect, it } from "vitest";
import {
  FALLBACK_VOICE_SELECTION,
  resolveDialogVoiceKey,
} from "./dialog-voice-mapping";
import { DEFAULT_VOICE_SETTINGS } from "@/lib/voice-intel/models";
import type { VoiceSelection } from "@/lib/voice-intel/types";

const sel = (overrides: Partial<VoiceSelection>): VoiceSelection => ({
  ...FALLBACK_VOICE_SELECTION,
  settings: { ...DEFAULT_VOICE_SETTINGS },
  ...overrides,
});

describe("resolveDialogVoiceKey", () => {
  it("maps Adam cleanly to the sirius pipeline key with no note", () => {
    const r = resolveDialogVoiceKey(sel({ characterId: "adam" }));
    expect(r.legacyKey).toBe("sirius");
    expect(r.effectiveCharacterId).toBe("adam");
    expect(r.viaFallback).toBe(false);
    expect(r.note).toBeNull();
  });

  it("resolves an unmapped English voice to Adam with an explicit note", () => {
    const r = resolveDialogVoiceKey(sel({ characterId: "sawyer" }));
    expect(r.viaFallback).toBe(true);
    expect(r.effectiveCharacterId).toBe("adam");
    expect(r.legacyKey).toBe("sirius");
    expect(r.note).toContain("Sawyer");
    expect(r.note).toContain("Adam");
  });

  it("is honest when a language has no provider voice at all (Hindi)", () => {
    const r = resolveDialogVoiceKey(
      sel({ languageCode: "hi", characterId: "niraj" }),
    );
    expect(r.viaFallback).toBe(true);
    expect(r.note).toContain("Niraj");
    expect(r.note).toContain("Hindi");
    expect(r.note).toContain("standard narration voice");
  });

  it("flags provider-mapped voices the pipeline can't consume (Elli)", () => {
    const r = resolveDialogVoiceKey(
      sel({ languageCode: "de", characterId: "elli" }),
    );
    expect(r.viaFallback).toBe(true);
    expect(r.note).toContain("Elli");
    expect(r.note).toContain("video pipeline");
  });

  it("never returns an empty legacy key", () => {
    const r = resolveDialogVoiceKey(
      sel({ languageCode: "xx", characterId: "nope" }),
    );
    expect(r.legacyKey.length).toBeGreaterThan(0);
    expect(r.note).not.toBeNull();
  });

  it("derives availability from the backend flag, not a hardcoded guess", () => {
    // With a healthy provider, a mapped-but-pipeline-unknown voice (Elli)
    // still falls back explicitly — the pipeline only knows legacy keys.
    const ready = resolveDialogVoiceKey(
      sel({ languageCode: "de", characterId: "elli" }),
      true,
    );
    expect(ready.viaFallback).toBe(true);
    expect(ready.note).toContain("Elli");
    // Adam maps cleanly either way.
    expect(
      resolveDialogVoiceKey(sel({ characterId: "adam" }), true).note,
    ).toBeNull();
  });
});
