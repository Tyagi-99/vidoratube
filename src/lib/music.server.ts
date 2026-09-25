/**
 * P4 music providers — royalty-free background tracks.
 *
 * NOTE (verified 2026-09-25): Pixabay's public API covers images and videos
 * ONLY — there is no music/audio endpoint. Music comes from Jamendo
 * (https://developer.jamendo.com/v3.0, free tier), which serves CC-licensed
 * tracks with a real search API. Requires JAMENDO_CLIENT_ID.
 */

export type MusicMood = "uplifting" | "tense" | "calm" | "epic" | "playful";

export const MUSIC_MOODS: MusicMood[] = [
  "uplifting",
  "tense",
  "calm",
  "epic",
  "playful",
];

export interface MusicTrack {
  providerTrackId: string;
  title: string;
  artist: string;
  mood: MusicMood;
  previewUrl: string | null;
  downloadUrl: string | null;
  license: string;
  licenseUrl: string | null;
  durationSecs: number | null;
}

/** Maps our moods to Jamendo tag searches. */
const MOOD_TAGS: Record<MusicMood, string> = {
  uplifting: "upbeat happy",
  tense: "tense suspense",
  calm: "calm ambient",
  epic: "epic cinematic",
  playful: "playful fun",
};

export function jamendoConfigured(): boolean {
  return Boolean(process.env["JAMENDO_CLIENT_ID"]);
}

/**
 * Searches Jamendo for CC-licensed tracks matching a mood.
 * Returns tracks with preview/download URLs and license info.
 */
export async function searchJamendo(mood: MusicMood, limit = 20): Promise<MusicTrack[]> {
  const clientId = process.env["JAMENDO_CLIENT_ID"];
  if (!clientId) {
    throw new Error(
      "Music search is not configured. Add a free Jamendo client ID (JAMENDO_CLIENT_ID) to enable background music."
    );
  }
  const params = new URLSearchParams({
    client_id: clientId,
    format: "json",
    limit: String(Math.min(limit, 50)),
    tags: MOOD_TAGS[mood],
    include: "musicinfo",
    // Prefer instrumental tracks for background use
    instrument: "1",
  });
  const res = await fetch(`https://api.jamendo.com/v3.0/tracks/?${params}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`Jamendo search failed (${res.status}). Try again in a moment.`);
  }
  const json = (await res.json()) as {
    results?: {
      id: string;
      name: string;
      artist_name?: string;
      duration?: number;
      audio?: string;
      audiodownload?: string;
      license_ccurl?: string;
    }[];
  };
  return (json.results ?? []).map((t) => ({
    providerTrackId: t.id,
    title: t.name,
    artist: t.artist_name ?? "Unknown artist",
    mood,
    previewUrl: t.audio ?? null,
    downloadUrl: t.audiodownload ?? t.audio ?? null,
    license: "Creative Commons (see license link)",
    licenseUrl: t.license_ccurl ?? "https://creativecommons.org/",
    durationSecs: t.duration ?? null,
  }));
}
