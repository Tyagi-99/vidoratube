/**
 * Sprint 3-4: cached paragraph narration.
 *
 * TTS is cached per (provider, voice_id, language_code, paragraph_hash).
 * Re-renders and chapter-only re-renders reuse unchanged paragraphs — an
 * identical paragraph is never re-synthesized.
 *
 * The core (`synthesizeCachedParagraphs`) is pure logic over injected
 * dependencies so the "same paragraph twice → one TTS call" guarantee is
 * unit-testable with a mocked provider. `makeSupabaseTtsDeps` wires it to
 * the real `tts_cache` table + storage bucket (server-only; the table has
 * no client RLS policies).
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** Collapse whitespace runs and trim. Language-neutral: visible characters untouched. */
export function normalizeParagraph(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** sha256 hex of the normalized paragraph — the cache key's text component. */
export function paragraphHash(text: string): string {
  return createHash("sha256").update(normalizeParagraph(text), "utf8").digest("hex");
}

export interface TtsCacheKey {
  provider: string;
  voiceId: string;
  languageCode: string;
}

export interface CachedParagraph {
  /** Original (un-normalized) paragraph text. */
  text: string;
  /** Storage path of the narration audio. */
  audioPath: string;
  durationSeconds: number;
}

export interface SynthesizeCachedDeps extends TtsCacheKey {
  /**
   * Synthesize one paragraph. Called at most once per unique paragraph
   * hash per invocation — and never for hashes already in the cache.
   */
  synthesize: (text: string) => Promise<{ audio: Buffer; durationSeconds: number }>;
  /** Look up cache rows for the given paragraph hashes. */
  findCached: (
    hashes: string[],
  ) => Promise<Map<string, { audioPath: string; durationSeconds: number }>>;
  /** Persist one cache row (upsert on the unique lookup key). */
  saveCached: (entry: {
    hash: string;
    audioPath: string;
    durationSeconds: number;
    byteSize: number;
  }) => Promise<void>;
  /** Upload synthesized audio; resolves to the storage path. */
  uploadAudio: (hash: string, audio: Buffer) => Promise<string>;
}

/**
 * Resolve narration audio for every paragraph, synthesizing only cache
 * misses. Identical paragraphs within the batch share one synthesis.
 */
export async function synthesizeCachedParagraphs(
  paragraphs: string[],
  deps: SynthesizeCachedDeps,
): Promise<CachedParagraph[]> {
  const hashes = paragraphs.map(paragraphHash);
  const uniqueHashes = [...new Set(hashes)];
  const cached = await deps.findCached(uniqueHashes);

  const resolved = new Map<string, { audioPath: string; durationSeconds: number }>();
  const missing: { hash: string; text: string }[] = [];
  const seen = new Set<string>();
  hashes.forEach((hash, i) => {
    const hit = cached.get(hash);
    if (hit) {
      resolved.set(hash, hit);
    } else if (!seen.has(hash)) {
      seen.add(hash);
      missing.push({ hash, text: paragraphs[i]! });
    }
  });

  // Synthesize misses sequentially: deterministic order, and TTS providers
  // rate-limit concurrent requests anyway.
  for (const m of missing) {
    const { audio, durationSeconds } = await deps.synthesize(m.text);
    const audioPath = await deps.uploadAudio(m.hash, audio);
    await deps.saveCached({
      hash: m.hash,
      audioPath,
      durationSeconds,
      byteSize: audio.byteLength,
    });
    resolved.set(m.hash, { audioPath, durationSeconds });
  }

  return paragraphs.map((text, i) => {
    const r = resolved.get(hashes[i]!);
    if (!r) throw new Error("TTS cache resolution failed: paragraph has no audio");
    return { text, audioPath: r.audioPath, durationSeconds: r.durationSeconds };
  });
}

/** Storage layout: tts-cache/{provider}/{voiceId}/{languageCode}/{hash}.mp3 */
export function ttsCacheStoragePath(key: TtsCacheKey, hash: string): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `tts-cache/${safe(key.provider)}/${safe(key.voiceId)}/${safe(key.languageCode)}/${hash}.mp3`;
}

type AdminClient = SupabaseClient<Database>;

/**
 * Wire `synthesizeCachedParagraphs` to Supabase. Server-only: uses the
 * service-role client (tts_cache has no client RLS policies).
 */
export function makeSupabaseTtsDeps(
  supabaseAdmin: AdminClient,
  key: TtsCacheKey,
  bucket: string,
  synthesize: (text: string) => Promise<{ audio: Buffer; durationSeconds: number }>,
): SynthesizeCachedDeps {
  return {
    ...key,
    synthesize,
    findCached: async (hashes) => {
      const out = new Map<string, { audioPath: string; durationSeconds: number }>();
      if (hashes.length === 0) return out;
      const { data, error } = await supabaseAdmin
        .from("tts_cache")
        .select("paragraph_hash,audio_path,duration_seconds")
        .eq("provider", key.provider)
        .eq("voice_id", key.voiceId)
        .eq("language_code", key.languageCode)
        .in("paragraph_hash", hashes);
      if (error) throw new Error(`tts_cache lookup failed: ${error.message}`);
      for (const row of data ?? []) {
        out.set(row.paragraph_hash, {
          audioPath: row.audio_path,
          durationSeconds: Number(row.duration_seconds ?? 0),
        });
      }
      return out;
    },
    saveCached: async (entry) => {
      const { error } = await supabaseAdmin.from("tts_cache").upsert(
        {
          provider: key.provider,
          voice_id: key.voiceId,
          language_code: key.languageCode,
          paragraph_hash: entry.hash,
          audio_path: entry.audioPath,
          duration_seconds: entry.durationSeconds,
          byte_size: entry.byteSize,
        },
        { onConflict: "provider,voice_id,language_code,paragraph_hash" },
      );
      if (error) throw new Error(`tts_cache upsert failed: ${error.message}`);
    },
    uploadAudio: async (hash, audio) => {
      const path = ttsCacheStoragePath(key, hash);
      const { error } = await supabaseAdmin.storage
        .from(bucket)
        .upload(path, audio, { contentType: "audio/mpeg", upsert: true });
      if (error) throw new Error(`TTS audio upload failed: ${error.message}`);
      return path;
    },
  };
}
