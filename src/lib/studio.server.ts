import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { presetById, styleById, type VisualType } from "./studio-config";
import { providerFetch } from "./providers/http.server";
import { findBestStockAsset, type StockAsset } from "./providers/stock.server";
import { activeImageProvider } from "./providers/image.server";
import {
  mp3Duration,
  synthesize,
  DEFAULT_VOICE_ID,
  DEFAULT_VOICE_MODEL,
} from "./providers/voice.server";
import {
  ELEVENLABS_TTS_USD_PER_CHAR,
  estimateTokens,
  extractUsage,
  gatewayChatUnitCostUsd,
  recordApiCost,
  type CostCtx,
  type GatewayUsage,
} from "./api-cost";

const BUCKET = "generated-videos";
const SIGNED_URL_TTL = 60 * 60 * 24 * 365;
const CHAT_MODEL = "google/gemini-2.5-flash";

type Admin = SupabaseClient<Database>;

/* --------------------------------- utils -------------------------------- */

export async function uploadAsset(
  admin: Admin,
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

async function chatJson<T>(
  system: string,
  user: string,
): Promise<{ data: T; usage: GatewayUsage | null }> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI is not configured on this project.");
  const res = await providerFetch(
    "Lovable AI",
    "https://ai.gateway.lovable.dev/v1/chat/completions",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
      timeoutMs: 180_000,
    },
  );
  const payload = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const usage = extractUsage(payload);
  const content = payload.choices?.[0]?.message?.content ?? "";
  const cleaned = content
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return { data: JSON.parse(cleaned) as T, usage };
  } catch {
    throw new Error("The AI returned an unreadable plan — try generating again.");
  }
}

/** Cost-recording context threaded through from the server-function caller. */
export type { CostCtx } from "./api-cost";

/** Records a gateway chat call's measured cost (tokens from usage, else estimated). */
async function recordChatCost(
  ctx: CostCtx,
  operation: string,
  system: string,
  user: string,
  usage: GatewayUsage | null,
  model: string,
): Promise<void> {
  const inputTokens = usage?.inputTokens ?? estimateTokens(system + user);
  const outputTokens = usage?.outputTokens ?? 0;
  const total = inputTokens + outputTokens;
  await recordApiCost(ctx.admin, {
    userId: ctx.userId,
    projectId: ctx.projectId,
    provider: "lovable-ai",
    operation,
    units: total,
    unitCostUsd: gatewayChatUnitCostUsd(inputTokens, outputTokens),
    meta: {
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      usage_reported: usage !== null,
      // The gateway bills its own credits; USD is the underlying model's
      // list price, a reference for cost direction — not an invoice.
      cost_basis: "gateway-passthrough-estimate",
      ...(ctx.mode ? { mode: ctx.mode } : {}),
    },
  });
}

/* ------------------------------ script plan ------------------------------ */

export type PlannedScene = {
  narration: string;
  visual_type: VisualType;
  search_queries: string[];
  image_prompt: string;
  negative_prompt: string;
};

export type ProjectPlan = {
  title: string;
  visual_bible: {
    era?: string;
    geography?: string;
    characters?: string;
    clothing?: string;
    architecture?: string;
    color_mood?: string;
    recurring_locations?: string;
  };
  scenes: PlannedScene[];
};

export async function planProject(
  input: {
    topic: string;
    script: string | null;
    mode: string;
    preset: string;
    category: string | null;
    language: string;
    durationMinutes: number;
    style: string;
  },
  /** Cost ctx: when provided, the gateway plan call's measured cost is recorded. */
  cost?: CostCtx,
): Promise<ProjectPlan> {
  const preset = presetById(input.preset);
  const targetSeconds = input.durationMinutes * 60;
  const avgScene = (preset.minScene + preset.maxScene) / 2;
  const sceneCount = Math.min(50, Math.max(4, Math.round(targetSeconds / avgScene)));

  const system = [
    "You are the head writer and visual director of a faceless YouTube documentary studio.",
    "You return STRICT JSON only, no prose.",
    "Historical accuracy is mandatory: never invent names, dates or events. If unsure, stay general.",
    `Narration tone: ${preset.voiceTone}. Language: ${input.language}.`,
  ].join(" ");

  const user = `
Produce a scene plan as JSON with this exact shape:
{
  "title": string,
  "visual_bible": { "era": string, "geography": string, "characters": string, "clothing": string, "architecture": string, "color_mood": string, "recurring_locations": string },
  "scenes": [{
    "narration": string,
    "visual_type": "STOCK_VIDEO" | "STOCK_IMAGE" | "AI_IMAGE" | "MAP" | "GRAPHIC" | "TEXT_ONLY",
    "search_queries": [string],
    "image_prompt": string,
    "negative_prompt": string
  }]
}

Rules:
- Produce exactly ${sceneCount} scenes. Each narration must read for roughly ${Math.round(avgScene)} seconds (${Math.round(avgScene * 2.5)} words).
- Video mode is "${input.mode}". ${
    input.mode === "image"
      ? 'Use "AI_IMAGE" for every scene.'
      : 'Choose "STOCK_VIDEO" or "STOCK_IMAGE" when generic footage (landscapes, ruins, nature, cities, skies, fire, rain, crowds) can carry the scene; choose "AI_IMAGE" when the scene needs a specific historical moment, person or event that stock media will never contain; choose "MAP" for routes, borders or campaigns.'
  }
- search_queries: 3 to 6 short, generic, highly searchable stock terms (no proper names that stock libraries lack).
- image_prompt: a rich visual description — subject, era, clothing, architecture, environment, composition, camera angle, lighting. No text in the image.
- negative_prompt: what to avoid (text, watermark, modern objects, distorted hands, etc).
- Image style for this project: ${styleById(input.style).label}.
${input.category ? `- Category: ${input.category}.` : ""}

${input.script ? `Use this script verbatim, split into scenes:\n${input.script.slice(0, 20000)}` : `Topic: ${input.topic}`}
`.trim();

  const { data: plan, usage } = await chatJson<ProjectPlan>(system, user);
  if (!plan.scenes?.length) throw new Error("The AI could not plan any scenes for this topic.");
  if (cost) {
    await recordChatCost(cost, "llm_plan", system, user, usage, CHAT_MODEL);
  }
  return plan;
}

/* ------------------------------- visuals -------------------------------- */

export async function resolveSceneVisual(
  admin: Admin,
  args: {
    userId: string;
    projectId: string;
    sceneId: string;
    sceneNumber: number;
    mode: string;
    visualType: VisualType;
    searchQuery: string | null;
    imagePrompt: string | null;
    negativePrompt: string | null;
    style: string;
    aspectRatio: string;
    visualBible: Record<string, unknown>;
    /** P4: character consistency — injected into the prompt. */
    characterName?: string | null;
    characterDescription?: string | null;
    /**
     * Sprint 5-6, source priority tier 1: user-uploaded footage for this
     * scene. When present it wins over stock and AI unconditionally —
     * rights first — and is returned as-is with provenance recorded.
     */
    userFootageUrl?: string | null;
  },
): Promise<{
  url: string;
  thumb: string;
  source: Record<string, unknown>;
  visualType: VisualType;
}> {
  // Tier 1: user-uploaded footage always wins — never replaced by stock or AI.
  if (args.userFootageUrl) {
    const { recordProvenance } = await import("./provenance");
    await recordProvenance(admin as never, {
      userId: args.userId,
      projectId: args.projectId,
      sceneId: args.sceneId,
      kind: /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(args.userFootageUrl) ? "video" : "image",
      provider: "user_upload",
      license: "User-owned footage",
      assetUrl: args.userFootageUrl,
    });
    return {
      url: args.userFootageUrl,
      thumb: args.userFootageUrl,
      source: {
        provider: "user_upload",
        kind: "user_footage",
        fetched_at: new Date().toISOString(),
      },
      visualType: args.visualType,
    };
  }

  const queries = (args.searchQuery ?? "")
    .split("|")
    .map((q) => q.trim())
    .filter(Boolean);

  // Stock first — it is free and preferred by the cost policy.
  if (
    args.mode === "stock" &&
    (args.visualType === "STOCK_VIDEO" || args.visualType === "STOCK_IMAGE")
  ) {
    let asset: StockAsset | null = null;
    try {
      asset = await findBestStockAsset(
        queries,
        args.visualType === "STOCK_VIDEO" ? "video" : "photo",
      );
      if (!asset && args.visualType === "STOCK_VIDEO") {
        asset = await findBestStockAsset(queries, "photo");
      }
    } catch {
      asset = null;
    }
    if (asset) {
      await recordApiCost(admin, {
        userId: args.userId,
        projectId: args.projectId,
        provider: asset.provider,
        operation: "stock_search",
        units: 1,
        unitCostUsd: 0, // stock discovery is free; the license cost is measured separately
        meta: { visual_type: asset.kind },
      });
      // Sprint 5-6: provenance for licensed stock — provider, license,
      // license URL, asset URL / asset id, and the scene link.
      const { recordProvenance } = await import("./provenance");
      await recordProvenance(admin as never, {
        userId: args.userId,
        projectId: args.projectId,
        sceneId: args.sceneId,
        kind: asset.kind === "video" ? "video" : "image",
        provider: asset.provider,
        model: asset.asset_id,
        license: asset.license,
        licenseUrl: asset.source_url,
        assetUrl: asset.url,
      });
      return {
        url: asset.url,
        thumb: asset.thumb_url || asset.url,
        source: asset as unknown as Record<string, unknown>,
        visualType: asset.kind === "video" ? "STOCK_VIDEO" : "STOCK_IMAGE",
      };
    }
    // No usable stock result → fall back to an AI image.
  }

  // P4: curated Studio v2 presets take precedence; legacy styles still work.
  const { STUDIO_STYLES, buildStyledPrompt } = await import("./styles");
  const studioStyle = STUDIO_STYLES.find((s) => s.id === args.style);
  const legacyModifier = styleById(args.style).prompt;
  const bible = Object.entries(args.visualBible ?? {})
    .filter(([, v]) => typeof v === "string" && v)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join("; ");
  const base = [
    args.imagePrompt ?? queries.join(", "),
    bible ? `Consistency notes — ${bible}.` : "",
  ]
    .filter(Boolean)
    .join(". ");

  const prompt = studioStyle
    ? buildStyledPrompt({
        basePrompt: base,
        styleId: studioStyle.id,
        characterName: args.characterName ?? null,
        characterDescription: args.characterDescription ?? null,
      })
    : [
        legacyModifier,
        base,
        args.characterName
          ? `featuring ${args.characterName}${args.characterDescription ? ` (${args.characterDescription})` : ""}`
          : "",
      ]
        .filter(Boolean)
        .join(". ");

  const provider = activeImageProvider();
  // Telemetry path: the ProviderResult envelope carries model / latency and
  // records the measured cost to api_usage on success (replaces the manual
  // recordApiCost below — one row per image, no double counting).
  const { generateImageWithTelemetry } = await import("./providers/image.server");
  const imageResult = await generateImageWithTelemetry(
    {
      prompt,
      negativePrompt: args.negativePrompt ?? "text, watermark, logo, distorted faces",
      aspectRatio: args.aspectRatio,
    },
    {
      costCtx: { admin, userId: args.userId, projectId: args.projectId },
      meta: {
        model: provider.id === "gemini" ? "google/gemini-2.5-flash-image" : provider.id,
      },
    },
  );
  if (!imageResult.ok || !imageResult.output) {
    throw new Error(imageResult.error?.message ?? "Image generation failed.");
  }
  const bytes = imageResult.output;
  const url = await uploadAsset(
    admin,
    `${args.userId}/${args.projectId}/scene-${args.sceneNumber}.png`,
    bytes,
    "image/png",
  );
  // P4: provenance — recorded where the provider facts are known.
  const { recordProvenance } = await import("./provenance");
  await recordProvenance(admin as never, {
    userId: args.userId,
    projectId: args.projectId,
    sceneId: args.sceneId,
    kind: "image",
    provider: provider.id,
    model: provider.id === "gemini" ? "google/gemini-2.5-flash-image" : undefined,
    prompt: base,
    assetUrl: url,
  });
  return {
    url,
    thumb: url,
    source: {
      provider: provider.id,
      kind: "ai_image",
      prompt,
      fetched_at: new Date().toISOString(),
    },
    visualType: "AI_IMAGE",
  };
}

/* -------------------------------- voice --------------------------------- */

export async function hashText(text: string, voiceId: string, model: string): Promise<string> {
  const data = new TextEncoder().encode(`${voiceId}:${model}:${text}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function generateSceneVoice(
  admin: Admin,
  args: {
    userId: string;
    projectId: string;
    sceneId: string;
    sceneNumber: number;
    narration: string;
    settings: {
      voiceId?: string;
      model?: string;
      stability?: number;
      similarity?: number;
      style?: number;
      speed?: number;
    };
  },
): Promise<{ url: string; duration: number; cacheKey: string }> {
  const voiceId = args.settings.voiceId || DEFAULT_VOICE_ID;
  const model = args.settings.model || DEFAULT_VOICE_MODEL;
  const cacheKey = await hashText(args.narration, voiceId, model);

  const { data: cached } = await admin
    .from("voiceovers")
    .select("audio_url, duration")
    .eq("scene_id", args.sceneId)
    .eq("cache_key", cacheKey)
    .maybeSingle();
  if (cached?.audio_url) {
    return { url: cached.audio_url, duration: Number(cached.duration ?? 0), cacheKey };
  }

  const audio = await synthesize(args.narration, {
    voiceId,
    model,
    ...(args.settings.stability !== undefined ? { stability: args.settings.stability } : {}),
    ...(args.settings.similarity !== undefined ? { similarity: args.settings.similarity } : {}),
    ...(args.settings.style !== undefined ? { style: args.settings.style } : {}),
    ...(args.settings.speed !== undefined ? { speed: args.settings.speed } : {}),
  });
  const duration = mp3Duration(audio, args.narration);
  const url = await uploadAsset(
    admin,
    `${args.userId}/${args.projectId}/voice-${args.sceneNumber}.mp3`,
    audio,
    "audio/mpeg",
  );

  await admin.from("voiceovers").upsert(
    {
      project_id: args.projectId,
      scene_id: args.sceneId,
      user_id: args.userId,
      audio_url: url,
      duration,
      characters: args.narration.length,
      voice_id: voiceId,
      model,
      cache_key: cacheKey,
    },
    { onConflict: "id" },
  );

  // ElevenLabs published API rate, Flash tier: $0.05 / 1k chars (see api-cost.ts).
  await recordApiCost(admin, {
    userId: args.userId,
    projectId: args.projectId,
    provider: "elevenlabs",
    operation: "tts",
    units: args.narration.length,
    unitCostUsd: ELEVENLABS_TTS_USD_PER_CHAR,
    meta: { model },
  });

  // P4: provenance for the generated voiceover.
  const { recordProvenance } = await import("./provenance");
  await recordProvenance(admin as never, {
    userId: args.userId,
    projectId: args.projectId,
    sceneId: args.sceneId,
    kind: "voice",
    provider: "elevenlabs",
    model,
    prompt: args.narration.slice(0, 500),
    assetUrl: url,
  });

  return { url, duration, cacheKey };
}

/* ------------------------------- captions -------------------------------- */

export type Cue = { start: number; end: number; text: string };

/** Splits narration into readable cues spread across the scene's real duration. */
export function buildCues(narration: string, duration: number, style: string): Cue[] {
  const maxWords = style === "sleep" ? 8 : style === "dynamic" ? 4 : 10;
  const words = narration.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += maxWords) {
    chunks.push(words.slice(i, i + maxWords).join(" "));
  }
  const per = duration / chunks.length;
  return chunks.map((text, i) => ({
    start: Math.round(i * per * 100) / 100,
    end: Math.round((i + 1) * per * 100) / 100,
    text,
  }));
}

export function cuesToSrt(cues: { start: number; end: number; text: string }[]): string {
  const stamp = (s: number) => {
    const ms = Math.round((s % 1) * 1000);
    const total = Math.floor(s);
    const hh = String(Math.floor(total / 3600)).padStart(2, "0");
    const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
    const ss = String(total % 60).padStart(2, "0");
    return `${hh}:${mm}:${ss},${String(ms).padStart(3, "0")}`;
  };
  return cues
    .map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`)
    .join("\n");
}
