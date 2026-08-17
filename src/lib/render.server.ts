import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const BUCKET = "generated-videos";
const SIGNED_URL_TTL = 60 * 60 * 24 * 365; // 1 year

const TTS_MODEL = "openai/gpt-4o-mini-tts";
const IMAGE_MODEL = "google/gemini-2.5-flash-image";

/** Maps Vidora's voice names to the underlying TTS voices. */
const VOICE_MAP: Record<string, string> = {
  deneb: "alloy",
  vega: "shimmer",
  orion: "onyx",
  lyra: "nova",
  atlas: "echo",
  nova: "nova",
};

function apiKey(): string {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI is not configured on this project.");
  return key;
}

function gatewayError(status: number): Error {
  if (status === 429) return new Error("The AI studio is busy right now — try again in a moment.");
  if (status === 402) return new Error("AI credits are exhausted. Add credits to keep rendering.");
  return new Error(`AI gateway error ${status}`);
}

async function upload(
  admin: SupabaseClient<Database>,
  path: string,
  bytes: ArrayBuffer | Uint8Array,
  contentType: string,
): Promise<string> {
  const { error } = await admin.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  const { data, error: signError } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL);
  if (signError || !data) throw new Error(`Could not sign asset URL: ${signError?.message}`);
  return data.signedUrl;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Generates the narration audio track and stores it. */
export async function generateVoiceover(
  admin: SupabaseClient<Database>,
  jobId: string,
  userId: string,
  narration: string,
  voice: string,
): Promise<{ url: string; estimatedSeconds: number }> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: TTS_MODEL,
      input: narration.slice(0, 4000),
      voice: VOICE_MAP[voice.toLowerCase()] ?? "alloy",
      response_format: "mp3",
    }),
  });
  if (!res.ok) throw gatewayError(res.status);

  const audio = await res.arrayBuffer();
  const url = await upload(admin, `${userId}/${jobId}/narration.mp3`, audio, "audio/mpeg");
  const words = narration.trim().split(/\s+/).length;
  return { url, estimatedSeconds: Math.max(8, Math.round((words / 150) * 60)) };
}

/** Generates one cinematic still per scene and stores them. */
export async function generateSceneImages(
  admin: SupabaseClient<Database>,
  jobId: string,
  userId: string,
  scenes: { visual: string; caption: string }[],
  format: string,
): Promise<string[]> {
  const selected = scenes.slice(0, 5);
  const urls: string[] = [];

  for (const [index, scene] of selected.entries()) {
    const prompt = `Cinematic ${format} b-roll still, 16:9 widescreen, photorealistic, filmic colour grading, no text or logos. Scene: ${scene.visual}`;
    const res = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        messages: [{ role: "user", content: prompt }],
        modalities: ["image", "text"],
      }),
    });
    if (!res.ok) throw gatewayError(res.status);

    const payload = (await res.json()) as { data?: { b64_json?: string }[] };
    const b64 = payload.data?.[0]?.b64_json;
    if (!b64) continue;
    urls.push(
      await upload(admin, `${userId}/${jobId}/scene-${index}.png`, base64ToBytes(b64), "image/png"),
    );
  }

  return urls;
}

/* ------------------------------------------------------------------ */
/* Shotstack composition                                               */
/* ------------------------------------------------------------------ */

export function shotstackConfigured(): boolean {
  return Boolean(process.env["SHOTSTACK_API_KEY"]);
}

function shotstackBase(): string {
  const env = process.env["SHOTSTACK_ENV"] === "v1" ? "v1" : "stage";
  return `https://api.shotstack.io/edit/${env}`;
}

/** Submits the timeline (images + captions + voiceover) to the render provider. */
export async function submitRender(input: {
  images: string[];
  audioUrl: string;
  captions: string[];
  durationSeconds: number;
  title: string;
}): Promise<string> {
  const key = process.env["SHOTSTACK_API_KEY"];
  if (!key) throw new Error("No render provider configured.");

  const count = Math.max(1, input.images.length);
  const per = Math.max(3, Math.round((input.durationSeconds / count) * 10) / 10);

  const imageClips = input.images.map((src, i) => ({
    asset: { type: "image", src },
    start: Number((i * per).toFixed(2)),
    length: per,
    effect: i % 2 === 0 ? "zoomIn" : "slideLeft",
    transition: { in: i === 0 ? "fade" : "carouselLeft", out: "fade" },
    fit: "cover",
  }));

  const captionClips = input.captions.slice(0, count).map((text, i) => ({
    asset: {
      type: "title",
      text: text.slice(0, 120),
      style: "subtitle",
      color: "#ffffff",
      size: "medium",
      position: "bottom",
    },
    start: Number((i * per + 0.4).toFixed(2)),
    length: Math.max(2, per - 0.8),
    transition: { in: "fade", out: "fade" },
  }));

  const res = await fetch(`${shotstackBase()}/render`, {
    method: "POST",
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      timeline: {
        background: "#04100f",
        soundtrack: { src: input.audioUrl, effect: "fadeOut" },
        tracks: [{ clips: captionClips }, { clips: imageClips }],
      },
      output: { format: "mp4", resolution: "hd", aspectRatio: "16:9" },
    }),
  });

  if (!res.ok) {
    throw new Error(`Render provider rejected the job (${res.status}): ${await res.text()}`);
  }
  const payload = (await res.json()) as { response?: { id?: string } };
  const id = payload.response?.id;
  if (!id) throw new Error("Render provider did not return a job id.");
  return id;
}

export async function pollRender(
  renderId: string,
): Promise<{ status: string; url: string | null; error: string | null }> {
  const key = process.env["SHOTSTACK_API_KEY"];
  if (!key) throw new Error("No render provider configured.");

  const res = await fetch(`${shotstackBase()}/render/${renderId}`, {
    headers: { "x-api-key": key },
  });
  if (!res.ok) throw new Error(`Render status check failed (${res.status})`);
  const payload = (await res.json()) as {
    response?: { status?: string; url?: string; error?: string };
  };
  return {
    status: payload.response?.status ?? "unknown",
    url: payload.response?.url ?? null,
    error: payload.response?.error ?? null,
  };
}

/** Copies the finished MP4 into our own storage so it never expires. */
export async function storeFinishedVideo(
  admin: SupabaseClient<Database>,
  jobId: string,
  userId: string,
  sourceUrl: string,
): Promise<string> {
  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error("Could not download the finished video.");
  const bytes = await res.arrayBuffer();
  return upload(admin, `${userId}/${jobId}/video.mp4`, bytes, "video/mp4");
}

/** Downloads the stored MP4 bytes (used for publishing to YouTube). */
export async function downloadStoredVideo(
  admin: SupabaseClient<Database>,
  jobId: string,
  userId: string,
): Promise<Blob> {
  const { data, error } = await admin.storage
    .from(BUCKET)
    .download(`${userId}/${jobId}/video.mp4`);
  if (error || !data) throw new Error("The rendered video file is not available yet.");
  return data;
}
