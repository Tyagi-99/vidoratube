import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "./server-auth";
import { MUSIC_MOODS, searchJamendo, type MusicMood } from "./music.server";
import { voiceById } from "./voices";
import {
  filterProvenCatalogTracks,
  hasMusicProvenance,
  logProvenanceExclusions,
} from "./music-provenance";

/**
 * Studio v2 (P4) server functions — characters, music library, voice preview.
 *
 * Characters: user-defined recurring cast for visual consistency.
 * Music: Jamendo-backed royalty-free catalog, cached in music_tracks.
 * Voice preview: short cached TTS sample per voice.
 */

const CharacterInput = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(2000).default(""),
  referenceImageUrl: z.string().url().max(2000).nullable().optional(),
});

const UpdateProjectInput = z.object({
  id: z.string().uuid(),
  visual_style: z.string().max(60).optional(),
  music_track_id: z.string().uuid().nullable().optional(),
  music_volume: z.number().min(0).max(1).optional(),
  music_ducking: z.boolean().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

/** Updates P4 studio settings on a project (owner-only). */
export const updateProjectSettings = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => UpdateProjectInput.parse(i))
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    // Provenance gate (defense in depth): a catalog track can only be
    // attached to a project when its licensing provenance is recorded.
    // BYO music (music_url in project settings) is unaffected.
    if (patch.music_track_id) {
      const { data: track, error: trackError } = await context.supabase
        .from("music_tracks")
        .select("id,provider,license,license_url")
        .eq("id", patch.music_track_id)
        .maybeSingle();
      if (trackError || !track) throw new Error("That music track no longer exists.");
      if (!hasMusicProvenance(track)) {
        console.warn(
          `[music-catalog] updateProjectSettings: rejected track ${patch.music_track_id} — missing licensing provenance`,
        );
        throw new Error(
          "That music track is missing license information and can't be used. Pick another track or upload your own music.",
        );
      }
    }
    const { error } = await context.supabase
      .from("projects")
      .update(patch as never)
      .eq("id", id)
      .eq("user_id", context.userId);
    if (error) throw new Error("Couldn't save project settings.");
    return { ok: true };
  });

// --- Characters -------------------------------------------------------------

export const listCharacters = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("characters")
      .select("id,name,description,reference_image_url,created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error("Couldn't load characters.");
    return (data ?? []) as { id: string; name: string; description: string; reference_image_url: string | null; created_at: string }[];
  });

export const createCharacter = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => CharacterInput.parse(i))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { enforcePostgresRateLimit } = await import("./rate-limit");
    await enforcePostgresRateLimit(
      supabaseAdmin,
      `studio:character:${userId}`,
      { max: 20, windowSeconds: 3600 },
      "You're creating characters too fast. Please wait a bit."
    );
    const { data: row, error } = await supabaseAdmin
      .from("characters")
      .insert({
        user_id: userId,
        name: data.name,
        description: data.description,
        reference_image_url: data.referenceImageUrl ?? null,
      })
      .select("id,name,description,reference_image_url,created_at")
      .single();
    if (error) throw new Error("Couldn't create the character.");
    return row;
  });

export const deleteCharacter = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("characters")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error("Couldn't delete the character.");
    return { ok: true };
  });

// --- Music ------------------------------------------------------------------

const MusicSearchInput = z.object({
  mood: z.enum(MUSIC_MOODS),
  limit: z.number().int().min(1).max(30).default(12),
});

/**
 * Searches Jamendo and upserts results into the music_tracks catalog.
 * Returns cached tracks for the mood.
 */
export const searchMusic = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => MusicSearchInput.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const tracks = await searchJamendo(data.mood as MusicMood, data.limit);
    // Upsert into catalog (service-role; RLS has no user insert policy)
    for (const t of tracks) {
      await supabaseAdmin.from("music_tracks").upsert(
        {
          title: t.title,
          artist: t.artist,
          mood: t.mood,
          provider: "jamendo",
          provider_track_id: t.providerTrackId,
          preview_url: t.previewUrl,
          download_url: t.downloadUrl,
          license: t.license,
          license_url: t.licenseUrl,
          duration_secs: t.durationSecs,
        },
        { onConflict: "provider,provider_track_id" }
      );
    }
    const { data: cached } = await supabaseAdmin
      .from("music_tracks")
      .select("id,title,artist,mood,preview_url,duration_secs,license,provider,license_url")
      .eq("mood", data.mood)
      .order("created_at", { ascending: false })
      .limit(30);
    // Provenance gate: only tracks with recorded licensing may be selected.
    const rows = (cached ?? []) as {
      id: string;
      title: string;
      artist: string;
      mood: string;
      preview_url: string | null;
      duration_secs: number | null;
      license: string | null;
      provider: string | null;
      license_url: string | null;
    }[];
    const { selectable, excluded } = filterProvenCatalogTracks(rows);
    logProvenanceExclusions("searchMusic", excluded, (t) => `${t.id} "${t.title}"`);
    return selectable.map(({ id, title, artist, mood, preview_url, duration_secs, license }) => ({
      id,
      title,
      artist,
      mood,
      preview_url,
      duration_secs,
      license,
    }));
  });

export const listMusicTracks = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ mood: z.enum(MUSIC_MOODS).optional() }).optional().parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("music_tracks")
      .select("id,title,artist,mood,preview_url,duration_secs,license,provider,license_url")
      .order("created_at", { ascending: false })
      .limit(60);
    if (data?.mood) q = q.eq("mood", data.mood);
    const { data: rows, error } = await q;
    if (error) throw new Error("Couldn't load music tracks.");
    // Provenance gate: only tracks with recorded licensing may be selected.
    const typed = (rows ?? []) as {
      id: string;
      title: string;
      artist: string;
      mood: string;
      preview_url: string | null;
      duration_secs: number | null;
      license: string | null;
      provider: string | null;
      license_url: string | null;
    }[];
    const { selectable, excluded } = filterProvenCatalogTracks(typed);
    logProvenanceExclusions("listMusicTracks", excluded, (t) => `${t.id} "${t.title}"`);
    return selectable.map(({ id, title, artist, mood, preview_url, duration_secs, license }) => ({
      id,
      title,
      artist,
      mood,
      preview_url,
      duration_secs,
      license,
    }));
  });

// --- Voice preview ----------------------------------------------------------

const VoicePreviewInput = z.object({
  voiceId: z.string().min(1).max(80),
  /** Preview text; keep short to save synthesis cost. */
  text: z.string().trim().min(1).max(160).default("Namaste! This is how I sound."),
});

/**
 * Returns a short cached TTS preview for a catalog voice.
 * Cached in the generated-videos bucket under previews/ so repeat plays are free.
 */
export const previewVoice = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => VoicePreviewInput.parse(i))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const voice = voiceById(data.voiceId);
    if (!voice) throw new Error("Unknown voice.");
    if (!voice.providerVoiceId) {
      throw new Error("Library voices need an ElevenLabs key to preview.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { enforcePostgresRateLimit } = await import("./rate-limit");
    await enforcePostgresRateLimit(
      supabaseAdmin,
      `studio:voice-preview:${userId}`,
      { max: 30, windowSeconds: 3600 },
      "Too many previews. Please wait a bit."
    );

    const cachePath = `previews/voice-${voice.id}.mp3`;
    // Serve from cache when present
    const { data: existing } = await supabaseAdmin.storage
      .from("generated-videos")
      .download(cachePath);
    if (existing) {
      const { data: signed } = await supabaseAdmin.storage
        .from("generated-videos")
        .createSignedUrl(cachePath, 3600);
      return { url: signed?.signedUrl ?? null, cached: true };
    }

    // Synthesize a short sample
    const { synthesize, DEFAULT_VOICE_MODEL } = await import("./providers/voice.server");
    let audio: ArrayBuffer;
    let previewProvider = "elevenlabs";
    if (voice.provider === "elevenlabs") {
      audio = await synthesize(data.text, {
        voiceId: voice.providerVoiceId,
        model: DEFAULT_VOICE_MODEL,
      });
    } else {
      audio = await synthesizeGatewayPreview(data.text, voice.providerVoiceId);
      previewProvider = "lovable-ai";
    }
    // Sprint 1: measured TTS cost for the preview (cached replays cost nothing).
    const {
      ELEVENLABS_TTS_USD_PER_CHAR,
      GATEWAY_TTS_USD_PER_CHAR,
      recordApiCost,
    } = await import("./api-cost");
    await recordApiCost(supabaseAdmin, {
      userId,
      provider: previewProvider,
      operation: "tts",
      units: data.text.length,
      unitCostUsd:
        previewProvider === "elevenlabs" ? ELEVENLABS_TTS_USD_PER_CHAR : GATEWAY_TTS_USD_PER_CHAR,
      meta: {
        preview: true,
        voice_id: data.voiceId,
        ...(previewProvider === "lovable-ai"
          ? { model: "gpt-4o-mini-tts", cost_basis: "gateway-passthrough-estimate" }
          : { model: DEFAULT_VOICE_MODEL }),
      },
    });
    const { error: upErr } = await supabaseAdmin.storage
      .from("generated-videos")
      .upload(cachePath, audio, { contentType: "audio/mpeg", upsert: true });
    if (upErr) throw new Error("Couldn't cache the preview.");
    const { data: signed } = await supabaseAdmin.storage
      .from("generated-videos")
      .createSignedUrl(cachePath, 3600);
    return { url: signed?.signedUrl ?? null, cached: false };
  });

/** Short TTS sample via the Lovable AI gateway (for gateway catalog voices). */
async function synthesizeGatewayPreview(text: string, voice: string): Promise<ArrayBuffer> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("Voice preview is not configured.");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      input: text.slice(0, 4000),
      voice,
      response_format: "mp3",
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error("Voice preview failed. Try again in a moment.");
  return res.arrayBuffer();
}
