import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  GATEWAY_IMAGE_USD_PER_IMAGE,
  GATEWAY_TTS_USD_PER_CHAR,
  SHOTSTACK_USD_PER_RENDER_MINUTE,
  recordApiCost,
  type CostCtx,
} from "./api-cost";

const BUCKET = "generated-videos";

function looksLikeMp4(bytes: ArrayBuffer | Uint8Array): boolean {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length < 12) return false;
  return u8[4] === 0x66 && u8[5] === 0x74 && u8[6] === 0x79 && u8[7] === 0x70;
}

const SIGNED_URL_TTL = 60 * 60 * 24 * 365; // 1 year

const TTS_MODEL = "openai/gpt-4o-mini-tts";
const IMAGE_MODEL = "google/gemini-2.5-flash-image";

/** Maps Vidora's voice names to Lovable/OpenAI TTS voices. */
const VOICE_MAP: Record<string, string> = {
  deneb: "alloy",
  sirius: "echo",
  vega: "shimmer",
  altair: "fable",
  orion: "onyx",
  lyra: "nova",
  atlas: "echo",
  nova: "nova",
};

/**
 * Maps quick-generate voice nicknames to ElevenLabs voice IDs.
 * Unknown names fall back to DEFAULT_VOICE_ID (George).
 */
const ELEVENLABS_VOICE_MAP: Record<string, string> = {
  // George / Adam / Rachel / Bella — stable public ElevenLabs IDs
  deneb: "JBFqnCBsd6RMkjVDRZzb",
  sirius: "pNInz6obpgDQGcFmaJgB",
  vega: "21m00Tcm4TlvDq8ikWAM",
  altair: "EXAVITQu4vr4xnSDxMaL",
};

function apiKey(): string {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI is not configured on this project.");
  return key;
}

function sanitiseGatewayBody(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; type?: string } };
    return (
      [parsed.error?.type, parsed.error?.message].filter(Boolean).join(": ") || body.slice(0, 200)
    );
  } catch {
    return body.slice(0, 200).replace(/\s+/g, " ").trim();
  }
}

function gatewayError(status: number, body = ""): Error {
  const detail = sanitiseGatewayBody(body);
  if (status === 429) return new Error("The AI studio is busy right now — try again in a moment.");
  if (status === 402) return new Error("AI credits are exhausted. Add credits to keep rendering.");
  return new Error(`AI gateway error ${status}${detail ? ` — ${detail}` : ""}`);
}

/** True when the provider refused the prompt on safety grounds (returned as a 400). */
function isContentBlocked(status: number, body: string): boolean {
  return status === 400 && /safety|blocked|content policy/i.test(body);
}

/** Removes the graphic wording that makes image safety filters refuse a historical scene. */
function softenPrompt(text: string): string {
  return text
    .replace(
      /\b(blood(?:ied|y)?|gore|gory|corpse[s]?|dead body|dead bodies|slaughter(?:ed)?|mutilat\w*|severed|killing|death of|dying|wounded|carnage)\b/gi,
      "",
    )
    .replace(/\s{2,}/g, " ")
    .trim();
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

async function generateVoiceoverViaGateway(narration: string, voice: string): Promise<ArrayBuffer> {
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
  if (!res.ok) throw gatewayError(res.status, await res.text().catch(() => ""));
  return res.arrayBuffer();
}

/** Generates the narration audio track and stores it. Prefers ElevenLabs when configured. */
export async function generateVoiceover(
  admin: SupabaseClient<Database>,
  jobId: string,
  userId: string,
  narration: string,
  voice: string,
  /**
   * Voice Intelligence selection (D328). When present and ElevenLabs is
   * configured, the TTS call honors the selected character + model +
   * settings (explicit fallback, never silent). Otherwise the legacy
   * nickname map below is used unchanged.
   */
  voiceConfig?: unknown,
): Promise<{ url: string; estimatedSeconds: number }> {
  const text = narration.slice(0, 4000);
  let audio: ArrayBuffer | null = null;
  let estimatedSeconds: number | null = null;

  const {
    elevenLabsConfigured,
    synthesizeWithTelemetry,
    mp3Duration,
    DEFAULT_VOICE_ID,
    DEFAULT_VOICE_MODEL,
  } = await import("./providers/voice.server");
  if (elevenLabsConfigured()) {
    // Telemetry path: the ProviderResult envelope carries model / latency /
    // characters and records the measured cost to api_usage on success.
    let voiceId = ELEVENLABS_VOICE_MAP[voice.toLowerCase()] ?? DEFAULT_VOICE_ID;
    let model = DEFAULT_VOICE_MODEL;
    let settings: {
      stability?: number;
      similarity?: number;
      style?: number;
      speed?: number;
      speakerBoost?: boolean;
    } = {};
    const { isVoiceSelection, resolveSynthesisPlan } = await import("./voice-intel/plan");
    if (isVoiceSelection(voiceConfig)) {
      const plan = resolveSynthesisPlan(voiceConfig, text.length, true);
      if (plan.voiceId) voiceId = plan.voiceId;
      model = plan.modelId;
      settings = {
        stability: plan.settings.stability,
        similarity: plan.settings.similarityBoost,
        style: plan.settings.style,
        speed: plan.settings.speed,
        speakerBoost: plan.settings.speakerBoost,
      };
      if (plan.viaFallback || plan.fallbackNote) {
        console.warn(`[vidora] ElevenLabs voiceover for job ${jobId}: ${plan.fallbackNote}`);
      }
    }
    const result = await synthesizeWithTelemetry(
      text,
      { voiceId, model, ...settings },
      { costCtx: { admin, userId }, meta: { job_id: jobId, mode: "story" } },
    );
    if (result.ok && result.output) {
      audio = result.output;
      estimatedSeconds = Math.max(8, Math.round(mp3Duration(audio, text)));
    } else {
      console.warn(
        `[vidora] ElevenLabs voiceover failed for job ${jobId}; falling back to gateway TTS:`,
        result.error?.message,
      );
    }
  }

  if (!audio) {
    audio = await generateVoiceoverViaGateway(narration, voice);
    const words = narration.trim().split(/\s+/).length;
    estimatedSeconds = Math.max(8, Math.round((words / 150) * 60));
    // Gateway TTS (gpt-4o-mini-tts) fallback — passthrough estimate.
    await recordApiCost(admin, {
      userId,
      provider: "lovable-ai",
      operation: "tts",
      units: text.length,
      unitCostUsd: GATEWAY_TTS_USD_PER_CHAR,
      meta: {
        job_id: jobId,
        mode: "story",
        model: "gpt-4o-mini-tts",
        cost_basis: "gateway-passthrough-estimate",
      },
    });
  }

  const url = await upload(admin, `${userId}/${jobId}/narration.mp3`, audio, "audio/mpeg");
  return { url, estimatedSeconds: estimatedSeconds ?? 8 };
}

/** Orientation phrase for the image prompt, matching the output frame. */
export const ASPECT_ORIENTATION: Record<string, string> = {
  "16:9": "16:9 widescreen",
  "9:16": "9:16 vertical",
  "1:1": "1:1 square",
};

/** Generates one cinematic still per scene and stores them. */
export async function generateSceneImages(
  admin: SupabaseClient<Database>,
  jobId: string,
  userId: string,
  scenes: { visual: string; caption: string }[],
  format: string,
  aspect: string = "16:9",
): Promise<string[]> {
  const selected = scenes.slice(0, 5);
  const urls: string[] = [];
  let blocked = 0;

  const requestImage = async (prompt: string) => {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        messages: [{ role: "user", content: prompt }],
        modalities: ["image", "text"],
      }),
    });
    if (res.ok) {
      const payload = (await res.json()) as { data?: { b64_json?: string }[] };
      return { b64: payload.data?.[0]?.b64_json ?? null, status: res.status, body: "" };
    }
    const body = await res.text().catch(() => "");
    return { b64: null, status: res.status, body };
  };

  for (const [index, scene] of selected.entries()) {
    const orientation = ASPECT_ORIENTATION[aspect] ?? ASPECT_ORIENTATION["16:9"]!;
    const base = `Cinematic ${format} b-roll still, ${orientation}, photorealistic, filmic colour grading, no text or logos. Scene: `;
    let attempt = await requestImage(`${base}${scene.visual}`);

    if (isContentBlocked(attempt.status, attempt.body)) {
      console.warn(
        `[vidora] image blocked for scene ${index + 1} of job ${jobId}: ${sanitiseGatewayBody(attempt.body)} — retrying with a softened prompt`,
      );
      attempt = await requestImage(
        `${base}${softenPrompt(scene.visual)}. Tasteful, non-graphic historical reconstruction, no injury or gore shown.`,
      );
    }

    if (!attempt.b64 && attempt.status !== 200) {
      if (isContentBlocked(attempt.status, attempt.body)) {
        blocked += 1;
        console.warn(
          `[vidora] skipping scene ${index + 1} of job ${jobId}: ${sanitiseGatewayBody(attempt.body)}`,
        );
        continue;
      }
      console.error(
        `[vidora] image generation failed for scene ${index + 1} of job ${jobId} (status ${attempt.status}): ${sanitiseGatewayBody(attempt.body)}`,
      );
      throw gatewayError(attempt.status, attempt.body);
    }

    if (!attempt.b64) continue;
    const imageUrl = await upload(
      admin,
      `${userId}/${jobId}/scene-${index}.png`,
      base64ToBytes(attempt.b64),
      "image/png",
    );
    urls.push(imageUrl);
    // Gateway image generation: flat per-image estimate (see api-cost.ts).
    await recordApiCost(admin, {
      userId,
      provider: "lovable-ai",
      operation: "image_generation",
      units: 1,
      unitCostUsd: GATEWAY_IMAGE_USD_PER_IMAGE,
      meta: {
        job_id: jobId,
        scene: index + 1,
        mode: "story",
        model: IMAGE_MODEL,
        cost_basis: "gateway-passthrough-estimate",
      },
    });
  }

  if (urls.length === 0 && blocked > 0) {
    throw new Error(
      "The image provider refused every scene on safety grounds — soften the script's graphic wording and try again.",
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
export async function submitRender(
  input: {
    images: string[];
    audioUrl: string;
    captions: string[];
    durationSeconds: number;
    title: string;
  },
  /** Cost ctx: when provided, the Shotstack render submission is cost-recorded. */
  cost?: CostCtx,
): Promise<string> {
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

  if (cost) {
    // Shotstack bills per rendered minute on production ($0.25/min); the
    // stage sandbox is free (see api-cost.ts).
    const production = process.env["SHOTSTACK_ENV"] === "v1";
    const minutes = Math.max(1, Math.ceil(input.durationSeconds / 60));
    await recordApiCost(cost.admin, {
      userId: cost.userId,
      projectId: cost.projectId,
      provider: "shotstack",
      operation: "render_submit",
      units: minutes,
      unitCostUsd: production ? SHOTSTACK_USD_PER_RENDER_MINUTE : 0,
      meta: { render_id: id, mode: "story", environment: production ? "production" : "stage" },
    });
  }
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
  if (bytes.byteLength < 1024) {
    throw new Error("Finished video file is empty or truncated.");
  }
  if (!looksLikeMp4(bytes)) {
    throw new Error("Finished video is not a valid MP4.");
  }
  return upload(admin, `${userId}/${jobId}/video.mp4`, bytes, "video/mp4");
}

/** Downloads the stored MP4 bytes (used for publishing to YouTube). */
export async function downloadStoredVideo(
  admin: SupabaseClient<Database>,
  jobId: string,
  userId: string,
): Promise<Blob> {
  const { data, error } = await admin.storage.from(BUCKET).download(`${userId}/${jobId}/video.mp4`);
  if (error || !data) throw new Error("The rendered video file is not available yet.");
  return data;
}
