/**
 * Production-readiness probes for /admin/readiness (Stream C, Phase 6).
 *
 * Admin-only (assertAdmin). Every check is a FREE metadata/config probe by
 * default — nothing here spends provider credits. The two opt-in paid
 * probes (TTS synthesis, one test image) run ONLY when the admin explicitly
 * passes `includePaidProbes: true`; they are never part of the default run.
 *
 * Status semantics follow src/lib/readiness.ts: "pass" / "fail" /
 * "unconfigured" (honest — UNCONFIGURED means the probe could not run, not
 * that the dependency is fine).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "./admin.server";
import {
  failed,
  passed,
  unconfigured,
  type ReadinessCheck,
  type ReadinessReport,
} from "./readiness";

const PROBE_TIMEOUT_MS = 8000;

function timeoutSignal(): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

async function freeProbe(
  url: string,
  headers: Record<string, string>,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const { signal, cancel } = timeoutSignal();
  try {
    const res = await fetch(url, { headers, signal });
    return { ok: res.ok, status: res.status };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "request failed" };
  } finally {
    cancel();
  }
}

const AI_TEXT_REMEDIATION =
  "Set LOVABLE_API_KEY in Lovable Cloud Secrets (Lovable dashboard → Project → Settings → Cloud Secrets) or the server environment. Required for AI text (scripting, ideas, SEO, analysis).";
const IMAGE_REMEDIATION =
  "Image generation uses the same LOVABLE_API_KEY via the Lovable AI gateway (Google Gemini image). Set it in Lovable Cloud Secrets — no separate key needed.";

async function aiTextCheck(): Promise<ReadinessCheck> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key)
    return unconfigured(
      "ai-text",
      "AI text provider",
      true,
      "LOVABLE_API_KEY",
      AI_TEXT_REMEDIATION,
    );
  const r = await freeProbe("https://ai.gateway.lovable.dev/v1/models", {
    Authorization: `Bearer ${key}`,
  });
  if (r.ok)
    return passed(
      "ai-text",
      "AI text provider",
      true,
      "Lovable AI gateway reachable (free /v1/models metadata probe).",
      AI_TEXT_REMEDIATION,
    );
  return failed(
    "ai-text",
    "AI text provider",
    true,
    `Lovable AI gateway probe failed: ${r.error ?? `HTTP ${r.status}`}. Key may be invalid or revoked.`,
    AI_TEXT_REMEDIATION,
  );
}

async function ttsCheck(paidProbes: boolean): Promise<ReadinessCheck> {
  const key = process.env["ELEVENLABS_API_KEY"];
  const openAi = process.env["OPENAI_API_KEY"];
  if (!key && !openAi)
    return unconfigured(
      "tts",
      "TTS (narration)",
      true,
      "ELEVENLABS_API_KEY",
      "Set ELEVENLABS_API_KEY (ElevenLabs dashboard → API keys) in Lovable Cloud Secrets / the server environment. Fallback: OPENAI_API_KEY enables OpenAI TTS instead.",
    );
  if (!key) {
    return passed(
      "tts",
      "TTS (narration)",
      true,
      "ElevenLabs not configured — OpenAI TTS fallback key present (OPENAI_API_KEY). Voice selection UI still expects ElevenLabs voices.",
      "Set ELEVENLABS_API_KEY for the full voice catalog.",
    );
  }
  const r = await freeProbe("https://api.elevenlabs.io/v2/user", { "xi-api-key": key });
  if (!r.ok)
    return failed(
      "tts",
      "TTS (narration)",
      true,
      `ElevenLabs probe failed: ${r.error ?? `HTTP ${r.status}`}. Key may be invalid or revoked.`,
      "Verify ELEVENLABS_API_KEY in the ElevenLabs dashboard (API keys) and update it in Lovable Cloud Secrets / the server environment.",
    );
  if (!paidProbes)
    return passed(
      "tts",
      "TTS (narration)",
      true,
      "ElevenLabs reachable (free /v2/user account probe).",
      "Set ELEVENLABS_API_KEY (ElevenLabs dashboard → API keys) in Lovable Cloud Secrets / the server environment.",
    );
  // Opt-in paid probe: one tiny real synthesis.
  try {
    const { synthesize, DEFAULT_VOICE_ID, DEFAULT_VOICE_MODEL, ttsUnitCostUsd } =
      await import("./providers/voice.server");
    const text = "Vidora readiness probe.";
    const audio = await synthesize(text, { voiceId: DEFAULT_VOICE_ID, model: DEFAULT_VOICE_MODEL });
    const cost = ttsUnitCostUsd(DEFAULT_VOICE_MODEL) * text.length;
    return passed(
      "tts",
      "TTS (narration)",
      true,
      `ElevenLabs reachable; opt-in paid probe synthesized ${text.length} characters (${audio.byteLength} bytes).`,
      "Set ELEVENLABS_API_KEY (ElevenLabs dashboard → API keys) in Lovable Cloud Secrets / the server environment.",
      `PAID PROBE: real synthesis of "${text}" — ESTIMATED cost $${cost.toFixed(4)} (billed by ElevenLabs).`,
    );
  } catch (error) {
    return failed(
      "tts",
      "TTS (narration)",
      true,
      `Opt-in paid TTS probe failed: ${error instanceof Error ? error.message : "synthesis failed"}.`,
      "Verify ELEVENLABS_API_KEY and the ElevenLabs account balance.",
    );
  }
}

async function imageCheck(paidProbes: boolean): Promise<ReadinessCheck> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key)
    return unconfigured(
      "image-gen",
      "Image generation",
      true,
      "LOVABLE_API_KEY",
      IMAGE_REMEDIATION,
    );
  const r = await freeProbe("https://ai.gateway.lovable.dev/v1/models", {
    Authorization: `Bearer ${key}`,
  });
  if (!r.ok)
    return failed(
      "image-gen",
      "Image generation",
      true,
      `Lovable AI gateway probe failed: ${r.error ?? `HTTP ${r.status}`}.`,
      IMAGE_REMEDIATION,
    );
  if (!paidProbes)
    return passed(
      "image-gen",
      "Image generation",
      true,
      "Gateway reachable; image model google/gemini-2.5-flash-image available via Lovable AI (config check only — no generation ran).",
      IMAGE_REMEDIATION,
    );
  // Opt-in paid probe: one tiny real image generation.
  try {
    const { activeImageProvider } = await import("./providers/image.server");
    const { GATEWAY_IMAGE_USD_PER_IMAGE } = await import("./api-cost");
    const bytes = await activeImageProvider().generate({
      prompt: "Vidora readiness probe: a plain mid-gray square",
      aspectRatio: "1:1",
    });
    return passed(
      "image-gen",
      "Image generation",
      true,
      `Gateway reachable; opt-in paid probe generated 1 test image (${bytes.length} bytes).`,
      IMAGE_REMEDIATION,
      `PAID PROBE: real image generation — ESTIMATED cost $${GATEWAY_IMAGE_USD_PER_IMAGE.toFixed(2)} (billed via the Lovable AI gateway).`,
    );
  } catch (error) {
    return failed(
      "image-gen",
      "Image generation",
      true,
      `Opt-in paid image probe failed: ${error instanceof Error ? error.message : "generation failed"}.`,
      IMAGE_REMEDIATION,
    );
  }
}

function videoCheck(): ReadinessCheck {
  const key = process.env["FAL_API_KEY"];
  const remediation =
    "Set FAL_API_KEY (fal.ai dashboard → API keys) in the server secrets. Optionally set VIDEO_FALLBACK_PROVIDER to a registered video adapter name.";
  if (!key)
    return unconfigured(
      "video-gen",
      "Video generation (Complete Video Mode)",
      false,
      "FAL_API_KEY",
      remediation,
    );
  return passed(
    "video-gen",
    "Video generation (Complete Video Mode)",
    false,
    "FAL_API_KEY present — Complete Video Mode adapter available (config check only).",
    remediation,
  );
}

async function storageCheck(): Promise<ReadinessCheck> {
  const remediation =
    "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the server environment and create the generated-videos storage bucket.";
  if (!process.env["SUPABASE_URL"] || !process.env["SUPABASE_SERVICE_ROLE_KEY"])
    return unconfigured(
      "storage",
      "Storage",
      true,
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
      remediation,
    );
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.storage.from("generated-videos").list("", { limit: 1 });
    if (error) throw new Error(error.message);
    return passed(
      "storage",
      "Storage",
      true,
      "generated-videos bucket reachable (free list probe).",
      remediation,
    );
  } catch (error) {
    return failed(
      "storage",
      "Storage",
      true,
      `Storage probe failed: ${error instanceof Error ? error.message : "unknown error"}.`,
      remediation,
    );
  }
}

async function databaseCheck(): Promise<ReadinessCheck> {
  const remediation =
    "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the server environment, then apply the Supabase migrations (supabase/migrations).";
  if (!process.env["SUPABASE_URL"] || !process.env["SUPABASE_SERVICE_ROLE_KEY"])
    return unconfigured(
      "database",
      "Database",
      true,
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
      remediation,
    );
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error, count } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    return passed(
      "database",
      "Database",
      true,
      `Postgres reachable (${count ?? 0} profiles, free count probe).`,
      remediation,
    );
  } catch (error) {
    return failed(
      "database",
      "Database",
      true,
      `Database probe failed: ${error instanceof Error ? error.message : "unknown error"}.`,
      remediation,
    );
  }
}

async function renderWorkerCheck(): Promise<ReadinessCheck> {
  const remediation =
    "Deploy the render worker (see worker/ and the deployment docs) — no recent heartbeat. Browser-side ffmpeg.wasm renders need no server key, but server renders require a live worker.";
  if (!process.env["SUPABASE_URL"] || !process.env["SUPABASE_SERVICE_ROLE_KEY"])
    return unconfigured(
      "render-worker",
      "FFmpeg / render service",
      true,
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
      remediation,
    );
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { workerHealthStatus, formatRelativeTime } = await import("./worker-health");
    const { data, error } = await supabaseAdmin
      .from("worker_heartbeats")
      .select("worker_id,last_seen_at")
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const status = workerHealthStatus(data?.last_seen_at ?? null);
    if (status === "ok") {
      return passed(
        "render-worker",
        "FFmpeg / render service",
        true,
        `Render worker heartbeat ${formatRelativeTime(data!.last_seen_at)} (worker ${data!.worker_id}).`,
        remediation,
      );
    }
    return failed(
      "render-worker",
      "FFmpeg / render service",
      true,
      data?.last_seen_at
        ? `Render worker heartbeat is stale (last beat ${formatRelativeTime(data.last_seen_at)}).`
        : "No render worker heartbeat has ever been recorded.",
      remediation,
    );
  } catch (error) {
    return failed(
      "render-worker",
      "FFmpeg / render service",
      true,
      `Render-worker probe failed: ${error instanceof Error ? error.message : "unknown error"}.`,
      remediation,
    );
  }
}

function youtubeOAuthCheck(): ReadinessCheck {
  const needed = [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "YOUTUBE_TOKEN_ENCRYPTION_KEY",
  ];
  const missing = needed.filter((k) => !process.env[k]);
  const remediation =
    "Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET (Google Cloud Console → APIs & Services → Credentials → OAuth client) and YOUTUBE_TOKEN_ENCRYPTION_KEY in Lovable Cloud Secrets. Complete Google OAuth verification in the Cloud Console before public use.";
  if (missing.length > 0)
    return unconfigured("youtube-oauth", "YouTube OAuth", false, missing.join(" / "), remediation);
  return passed(
    "youtube-oauth",
    "YouTube OAuth",
    false,
    "OAuth client + token encryption key configured (config check only — each user still connects their own channel in the app).",
    remediation,
  );
}

async function jobQueueCheck(): Promise<ReadinessCheck> {
  const remediation =
    "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the server environment; ensure the renders table migration is applied.";
  if (!process.env["SUPABASE_URL"] || !process.env["SUPABASE_SERVICE_ROLE_KEY"])
    return unconfigured(
      "job-queue",
      "Job queue",
      true,
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
      remediation,
    );
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [queued, running] = await Promise.all([
      supabaseAdmin
        .from("renders")
        .select("id", { count: "exact", head: true })
        .eq("engine", "server_ffmpeg")
        .eq("status", "queued"),
      supabaseAdmin
        .from("renders")
        .select("id", { count: "exact", head: true })
        .eq("engine", "server_ffmpeg")
        .eq("status", "running"),
    ]);
    if (queued.error) throw new Error(queued.error.message);
    if (running.error) throw new Error(running.error.message);
    return passed(
      "job-queue",
      "Job queue",
      true,
      `Server-render queue reachable (${queued.count ?? 0} queued, ${running.count ?? 0} running, free count probe).`,
      remediation,
    );
  } catch (error) {
    return failed(
      "job-queue",
      "Job queue",
      true,
      `Job-queue probe failed: ${error instanceof Error ? error.message : "unknown error"}.`,
      remediation,
    );
  }
}

function billingCheck(): ReadinessCheck {
  const dodo = Boolean(process.env["DODO_API_KEY"]);
  const razorpay = Boolean(process.env["RAZORPAY_KEY_ID"]);
  const remediation =
    "Set DODO_API_KEY and DODO_WEBHOOK_SECRET (Dodo Payments dashboard) for USD, and/or RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (Razorpay dashboard) for INR, in the server secrets.";
  if (!dodo && !razorpay)
    return unconfigured("billing", "Billing", true, "DODO_API_KEY / RAZORPAY_KEY_ID", remediation);
  const which = [dodo && "Dodo Payments (USD)", razorpay && "Razorpay (INR)"]
    .filter(Boolean)
    .join(" + ");
  return passed(
    "billing",
    "Billing",
    true,
    `${which} keys present (config check only — a live charge is never probed).`,
    remediation,
  );
}

/**
 * Admin-only production-readiness report. Free probes by default; the two
 * paid probes (TTS synthesis, test image) run only with explicit
 * `includePaidProbes: true` from the admin.
 */
export const getReadinessReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ includePaidProbes: z.boolean().default(false) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<ReadinessReport> => {
    await assertAdmin(context.supabase, context.userId);

    const checks = await Promise.all([
      aiTextCheck(),
      ttsCheck(data.includePaidProbes),
      imageCheck(data.includePaidProbes),
      Promise.resolve(videoCheck()),
      storageCheck(),
      databaseCheck(),
      renderWorkerCheck(),
      Promise.resolve(youtubeOAuthCheck()),
      jobQueueCheck(),
      Promise.resolve(billingCheck()),
    ]);

    return { checks, paidProbesRan: data.includePaidProbes, at: new Date().toISOString() };
  });
