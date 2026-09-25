import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { providerFetch } from "@/lib/providers/http.server";
import {
  DEFAULT_VOICE_ID,
  DEFAULT_VOICE_MODEL,
  mp3Duration,
  synthesize,
} from "@/lib/providers/voice.server";
import { buildCues, type Cue } from "@/lib/studio.server";
import { uploadAsset } from "@/lib/studio.server";
import {
  ELEVENLABS_TTS_USD_PER_CHAR,
  OPENAI_GPT4O_MINI_INPUT_USD_PER_MTOK,
  OPENAI_GPT4O_MINI_OUTPUT_USD_PER_MTOK,
  chatUnitCostUsd,
  estimateTokens,
  extractUsage,
  gatewayChatUnitCostUsd,
  recordApiCost,
  type CostCtx,
  type GatewayUsage,
} from "@/lib/api-cost";
import { targetWordCount } from "./duration";
export { readMode2Settings, type Mode2Settings } from "./settings";

type Admin = SupabaseClient<Database>;

async function chatJson<T>(
  system: string,
  user: string,
): Promise<{ data: T; usage: GatewayUsage | null; provider: string; model: string }> {
  const openaiKey = process.env["OPENAI_API_KEY"];
  if (openaiKey) {
    const model = process.env["OPENAI_MODEL"] || "gpt-4o-mini";
    const res = await providerFetch("OpenAI", "https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
      timeoutMs: 120_000,
    });
    const payload = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = payload.choices?.[0]?.message?.content ?? "";
    const cleaned = content.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    return { data: JSON.parse(cleaned) as T, usage: extractUsage(payload), provider: "openai", model };
  }

  const key = process.env["LOVABLE_API_KEY"];
  if (!key) {
    throw new Error(
      "Neither OPENAI_API_KEY nor LOVABLE_API_KEY is configured for commentary generation.",
    );
  }
  const model = "google/gemini-2.5-flash";
  const res = await providerFetch("Lovable AI", "https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
    timeoutMs: 120_000,
  });
  const payload = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = payload.choices?.[0]?.message?.content ?? "";
  const cleaned = content.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  return { data: JSON.parse(cleaned) as T, usage: extractUsage(payload), provider: "lovable-ai", model };
}

export type CommentaryPlan = {
  title: string;
  script: string;
  uncertainty: string;
  beats: { start_hint: number; text: string }[];
};

/**
 * Generate a Mode 2 commentary script from title/description/duration metadata.
 * Frame-level vision analysis is optional polish — this path labels uncertainty explicitly.
 */
export async function generateCommentaryScript(
  input: {
    title: string;
    description?: string | null;
    userNotes?: string | null;
    style: string;
    targetSeconds: number;
    sourceDurationSeconds?: number | null;
    language?: string;
  },
  /** Cost ctx: when provided, the commentary LLM call's measured cost is recorded. */
  cost?: CostCtx,
): Promise<CommentaryPlan> {
  const words = targetWordCount(input.targetSeconds);
  const system = [
    "You write voiceover commentary for existing video footage.",
    "Return STRICT JSON only.",
    "Do not invent specific on-screen events you cannot verify from the metadata.",
    "When details are uncertain, keep language general and note uncertainty.",
    `Language: ${input.language ?? "English"}. Tone/style: ${input.style}.`,
  ].join(" ");

  const user = `
Produce commentary JSON with this shape:
{
  "title": string,
  "script": string,
  "uncertainty": string,
  "beats": [{ "start_hint": number, "text": string }]
}

Rules:
- Target spoken length ~${input.targetSeconds} seconds (~${words} words). Keep script within 60–140% of that word count.
- Script is continuous narration suitable for ElevenLabs TTS (no stage directions, no [brackets]).
- beats: 3–8 rough sections with start_hint seconds from 0.
- uncertainty: one sentence describing what you could not verify without watching frames.
- Footage title: ${input.title || "(untitled upload)"}
- Footage description: ${input.description || "(none)"}
- User notes: ${input.userNotes || "(none)"}
- Source media duration (seconds, if known): ${input.sourceDurationSeconds ?? "unknown"}
`.trim();

  const { data: plan, usage, provider, model } = await chatJson<CommentaryPlan>(system, user);
  if (!plan.script?.trim()) throw new Error("Commentary model returned an empty script.");
  if (cost) {
    // OpenAI direct calls use OpenAI's published rate; gateway calls are a
    // passthrough estimate (see api-cost.ts).
    const isGateway = provider === "lovable-ai";
    const inputTokens = usage?.inputTokens ?? estimateTokens(system + user);
    const outputTokens = usage?.outputTokens ?? 0;
    await recordApiCost(cost.admin, {
      userId: cost.userId,
      projectId: cost.projectId,
      provider,
      operation: "llm_script",
      units: inputTokens + outputTokens,
      unitCostUsd: isGateway
        ? gatewayChatUnitCostUsd(inputTokens, outputTokens)
        : chatUnitCostUsd(
            inputTokens,
            outputTokens,
            OPENAI_GPT4O_MINI_INPUT_USD_PER_MTOK,
            OPENAI_GPT4O_MINI_OUTPUT_USD_PER_MTOK,
          ),
      meta: {
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        usage_reported: usage !== null,
        cost_basis: isGateway ? "gateway-passthrough-estimate" : "openai-list-price",
      },
    });
  }
  return {
    title: plan.title?.trim() || input.title || "Voiceover project",
    script: plan.script.trim(),
    uncertainty:
      plan.uncertainty?.trim() ||
      "Script generated from title/description/duration metadata only — not frame-accurate vision analysis.",
    beats: Array.isArray(plan.beats) ? plan.beats : [],
  };
}

export async function synthesizeProjectVoiceover(
  admin: Admin,
  args: {
    userId: string;
    projectId: string;
    script: string;
    voiceId?: string;
    model?: string;
  },
): Promise<{ url: string; duration: number }> {
  const voiceId = args.voiceId || DEFAULT_VOICE_ID;
  const model = args.model || DEFAULT_VOICE_MODEL;
  const audio = await synthesize(args.script, {
    voiceId,
    model,
  });
  const duration = mp3Duration(audio, args.script);
  const path = `${args.userId}/${args.projectId}/voiceover.mp3`;
  const url = await uploadAsset(admin, path, audio, "audio/mpeg");

  await admin.from("voiceovers").delete().eq("project_id", args.projectId).is("scene_id", null);
  await admin.from("voiceovers").insert({
    project_id: args.projectId,
    scene_id: null,
    user_id: args.userId,
    audio_url: url,
    duration,
    characters: args.script.length,
    voice_id: voiceId,
    model,
  });

  // ElevenLabs published API rate, Flash tier: $0.05 / 1k chars (see api-cost.ts).
  await recordApiCost(admin, {
    userId: args.userId,
    projectId: args.projectId,
    provider: "elevenlabs",
    operation: "tts",
    units: args.script.length,
    unitCostUsd: ELEVENLABS_TTS_USD_PER_CHAR,
    meta: { model },
  });

  return { url, duration };
}

export async function saveProjectCaptions(
  admin: Admin,
  args: {
    userId: string;
    projectId: string;
    script: string;
    duration: number;
    style?: string;
  },
): Promise<Cue[]> {
  const style = args.style || "documentary";
  const cues = buildCues(args.script, Math.max(args.duration, 1), style);
  await admin.from("captions").delete().eq("project_id", args.projectId);
  await admin.from("captions").insert({
    project_id: args.projectId,
    scene_id: null,
    user_id: args.userId,
    style,
    cues: cues as never,
  });
  return cues;
}
