/**
 * F17 Voice Studio — server functions (Stream D, Phase 3).
 *
 * EXTENDS the existing voiceover mode (Mode 2 dialog, jobs.functions.ts TTS
 * stage) into a multi-provider studio. Paid ops go through the Phase-1
 * credit preflight (preflightCreditsCheck) — INSUFFICIENT_CREDITS /
 * BUDGET_EXCEEDED are returned as result codes INSTEAD of a provider call.
 * Providers return ProviderResult envelopes and never throw.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  CreateUserVoiceSchema,
  VoiceoverJobSchema,
  type VoiceLibraryEntry,
  type VoiceoverJobResult,
} from "./types";
import {
  assertCloneLegal,
  mergeVoiceCatalog,
  routeVoiceForTts,
  validateVoiceUpload,
  type BuiltinVoiceRow,
  type UserVoiceRow,
} from "./library.server";
import {
  elevenLabsTtsProvider,
  gatewayTtsProvider,
  openAiTtsProvider,
  resolveTtsChain,
  synthesizeSpeechWithFallback,
  ttsAvailable,
  type TtsProvider,
} from "./chain.server";
import { elevenLabsConfigured } from "../../providers/voice.server";
import { openAiTtsConfigured } from "../../providers/openai-tts.server";

/* ── D89: local type aliases for the Phase-1 `voices` table ───────────────
 *
 * The generated DB types predate the creation migrations (`voices` is
 * absent entirely; `language_voices` still carries the pre-creation
 * columns), so `voices` rows are described here from
 * supabase/migrations/20260928020100_p1_creation.sql, following the
 * established `asJobsClient` pattern in
 * src/lib/jobs/durable-jobs.server.ts. `language_voices` queries below use
 * the generated types with the columns that actually exist (no
 * `voice_type` there — catalog entries are always builtins).
 */

export type VoiceRow = {
  id: string;
  user_id: string;
  name: string;
  provider: string;
  provider_voice_id: string | null;
  voice_type: string;
  language_code: string | null;
  verified: boolean;
  is_clone_legal: boolean;
  metadata: { storage_path?: string } | null;
  created_at: string;
  updated_at: string;
};

export type VoiceInsert = {
  id?: string;
  user_id: string;
  name: string;
  provider: string;
  provider_voice_id?: string | null;
  voice_type: string;
  language_code?: string | null;
  verified?: boolean;
  is_clone_legal?: boolean;
  metadata?: { storage_path?: string };
};

export type VoiceUpdate = {
  name?: string;
  provider?: string;
  provider_voice_id?: string | null;
  voice_type?: string;
  language_code?: string | null;
  verified?: boolean;
  is_clone_legal?: boolean;
  metadata?: { storage_path?: string };
};

type VoicesTables = {
  voices: {
    Row: VoiceRow;
    Insert: VoiceInsert;
    Update: VoiceUpdate;
    Relationships: [];
  };
};

/** `Database` extended with the `voices` table (D89 local alias). */
export type VoicesDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Omit<Database["public"]["Tables"], keyof VoicesTables> & VoicesTables;
  };
};

type VoicesClient = SupabaseClient<VoicesDatabase>;

/**
 * Narrow a standard client to the voices schema. The cast is contained
 * here so every query below uses fully-typed builders while callers keep
 * passing their ordinary `SupabaseClient<Database>`.
 */
function asVoicesClient(client: SupabaseClient<Database>): VoicesClient {
  return client as unknown as VoicesClient;
}

/** `language_voices` row → catalog shape used by `mergeVoiceCatalog`. */
function toBuiltinVoiceRow(row: {
  id: string;
  name: string;
  provider: string;
  provider_voice_id: string | null;
  language_code: string;
  verified: boolean;
}): BuiltinVoiceRow {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    providerVoiceId: row.provider_voice_id,
    voiceType: "builtin",
    languageCode: row.language_code,
    verified: row.verified,
  };
}

/** Local `VoiceRow` → catalog shape used by `mergeVoiceCatalog`. */
function toUserVoiceRow(row: VoiceRow): UserVoiceRow {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    provider_voice_id: row.provider_voice_id,
    voice_type: row.voice_type,
    language_code: row.language_code,
    verified: row.verified,
    is_clone_legal: row.is_clone_legal,
    metadata: row.metadata,
  };
}

/* ── provider status (drives the studio's unconfigured states) ─────────── */

export const getTtsProviderStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const elevenlabs = elevenLabsConfigured();
    const openai = openAiTtsConfigured();
    const gateway = Boolean(process.env["LOVABLE_API_KEY"]);
    return {
      providers: [
        { id: "elevenlabs", label: "ElevenLabs", configured: elevenlabs, role: "primary" },
        { id: "openai", label: "OpenAI TTS", configured: openai, role: "fallback" },
        { id: "gateway", label: "Lovable AI gateway", configured: gateway, role: "last resort" },
      ] as const,
      anyConfigured: elevenlabs || openai || gateway,
    };
  });

/* ── voice library ─────────────────────────────────────────────────────── */

export const listVoiceLibrary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ voices: VoiceLibraryEntry[] }> => {
    const { supabase, userId } = context;
    const voicesDb = asVoicesClient(supabase);
    const [{ data: builtin, error: builtinError }, { data: user, error: userError }] =
      await Promise.all([
        supabase
          .from("language_voices")
          .select("id, name, provider, provider_voice_id, language_code, verified")
          .order("name"),
        voicesDb.from("voices").select("*").eq("user_id", userId).order("name"),
      ]);
    if (builtinError) throw new Error(builtinError.message);
    if (userError) throw new Error(userError.message);
    return {
      voices: mergeVoiceCatalog(
        (builtin ?? []).map(toBuiltinVoiceRow),
        (user ?? []).map(toUserVoiceRow),
      ),
    };
  });

export const listVoiceLanguages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("languages")
      .select("code, name_en, name_native, status")
      .order("name_en");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** Minimal structural type for the service-role storage read used below. */
type SampleStorageReader = {
  storage: {
    from(bucket: string): {
      download(path: string): Promise<{
        data: { arrayBuffer(): Promise<ArrayBuffer> } | null;
        error: { message: string } | null;
      }>;
    };
  };
};

/**
 * Validate the uploaded sample's real bytes (magic bytes + size) against
 * the declared MIME type. Reads through the service-role client so the
 * check can't be bypassed by client-side claims.
 */
async function validateSampleObject(
  admin: SampleStorageReader,
  path: string,
  declaredMime: string | null,
  declaredBytes: number | null,
): Promise<void> {
  if (!declaredMime)
    throw new Error("A voice sample upload is required for voice_type 'uploaded'.");
  const { data, error } = await admin.storage.from("generated-videos").download(path);
  if (error || !data)
    throw new Error(`Could not read the uploaded sample: ${error?.message ?? "missing"}.`);
  const buf = await data.arrayBuffer();
  const check = validateVoiceUpload({
    declaredMime,
    bytes: declaredBytes ?? buf.byteLength,
    head: new Uint8Array(buf.slice(0, 16)),
  });
  if (!check.ok) throw new Error(check.reason);
}

export const createUserVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CreateUserVoiceSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Legal gate FIRST: cloning without explicit confirmation is blocked
    // server-side, regardless of what the client sent.
    const gate = assertCloneLegal({ voiceType: data.voiceType, isCloneLegal: data.isCloneLegal });
    if (!gate.allowed) throw new Error(gate.reason);

    if (data.voiceType === "uploaded") {
      if (!data.storagePath) {
        throw new Error("Upload a voice sample first, then create the voice.");
      }
      if (!data.storagePath.startsWith(`${userId}/voices/`)) {
        throw new Error("Invalid upload path.");
      }
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await validateSampleObject(
        supabaseAdmin,
        data.storagePath,
        data.sampleMimeType,
        data.sampleBytes,
      );
    }

    if (data.voiceType === "cloned" && !data.providerVoiceId) {
      throw new Error(
        "A cloned voice needs the provider's voice id (from the provider dashboard).",
      );
    }

    const { data: row, error } = await asVoicesClient(supabase)
      .from("voices")
      .insert({
        user_id: userId,
        name: data.name.trim(),
        provider: data.provider,
        provider_voice_id: data.providerVoiceId,
        voice_type: data.voiceType,
        language_code: data.languageCode,
        verified: false,
        is_clone_legal: data.voiceType === "cloned" ? data.isCloneLegal : false,
        metadata: data.storagePath ? { storage_path: data.storagePath } : {},
      })
      .select(
        "id, name, provider, provider_voice_id, voice_type, language_code, verified, is_clone_legal",
      )
      .single();
    if (error) {
      if (error.code === "23505") {
        throw new Error(`You already have a voice named "${data.name.trim()}". Pick another name.`);
      }
      throw new Error(error.message);
    }
    return row;
  });

const updateUserVoiceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(80).optional(),
  languageCode: z.string().max(16).nullable().optional(),
  /** May only be flipped true→ by the owner; the create-time gate still applies. */
  isCloneLegal: z.boolean().optional(),
});

export const updateUserVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => updateUserVoiceSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const patch: VoiceUpdate = {};
    if (data.name !== undefined) patch.name = data.name.trim();
    if (data.languageCode !== undefined) patch.language_code = data.languageCode;
    if (data.isCloneLegal !== undefined) patch.is_clone_legal = data.isCloneLegal;
    if (Object.keys(patch).length === 0) throw new Error("Nothing to update.");
    const { data: row, error } = await asVoicesClient(supabase)
      .from("voices")
      .update(patch)
      .eq("id", data.id)
      .eq("user_id", userId)
      .select(
        "id, name, provider, provider_voice_id, voice_type, language_code, verified, is_clone_legal",
      )
      .single();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Voice not found.");
    return row;
  });

export const deleteUserVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await asVoicesClient(supabase)
      .from("voices")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { deleted: true as const };
  });

/* ── text → speech job (durable job + preflight + fallback chain) ──────── */

const ALL_ADAPTERS: Record<string, TtsProvider> = {
  elevenlabs: elevenLabsTtsProvider,
  openai: openAiTtsProvider,
  gateway: gatewayTtsProvider,
};

/** Resolve a voice id (`builtin:<id>` or a `voices` row id) to a library entry. */
async function resolveVoiceEntry(
  supabase: SupabaseClient<Database>,
  userId: string,
  voiceId: string,
): Promise<VoiceLibraryEntry | null> {
  if (voiceId.startsWith("builtin:")) {
    const id = voiceId.slice("builtin:".length);
    const { data, error } = await supabase
      .from("language_voices")
      .select("id, name, provider, provider_voice_id, language_code, verified")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const [entry] = mergeVoiceCatalog([toBuiltinVoiceRow(data)], []);
    return entry ?? null;
  }
  const { data, error } = await asVoicesClient(supabase)
    .from("voices")
    .select("*")
    .eq("id", voiceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const [entry] = mergeVoiceCatalog([], [toUserVoiceRow(data)]);
  return entry ?? null;
}

/**
 * Text→speech through the fallback chain, wired to Phase-1 durable jobs and
 * the credit preflight. Flow:
 *
 *   1. Resolve voice → route to preferred provider (uploaded voices and
 *      unconfirmed clones are rejected, not synthesized).
 *   2. Credit preflight: INSUFFICIENT_CREDITS / BUDGET_EXCEEDED /
 *      UNKNOWN_COST return as result codes INSTEAD of a provider call.
 *   3. Create + claim the durable `generation_jobs` row (idempotency key
 *      dedupes retries; a completed job reuses its stored audio URL).
 *   4. Debit the ESTIMATE via the idempotent ledger RPC, then run the
 *      ordered chain (preferred provider first, then the rest).
 *   5. Upload the MP3 to storage, sign a playback URL, record the provider
 *      task + complete the job. Failures mark the job failed and refund via
 *      the existing refund path (failGenerationJob).
 */
export const runVoiceoverJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => VoiceoverJobSchema.parse(i))
  .handler(async ({ data, context }): Promise<VoiceoverJobResult> => {
    const { supabase, userId } = context;
    const {
      createGenerationJob,
      claimGenerationJob,
      recordProviderTask,
      completeGenerationJob,
      failGenerationJob,
    } = await import("../../jobs/durable-jobs.server");
    const { preflightCreditsCheck } = await import("../../credits/preflight.server");
    const { debitMinutesForJob } = await import("@/lib/credits");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const entry = await resolveVoiceEntry(supabase, userId, data.voiceId);
    if (!entry) {
      return { ok: false, code: "VOICE_NOT_FOUND", message: "That voice no longer exists." };
    }
    const route = routeVoiceForTts(entry);
    if (!route.synthesizable) {
      return { ok: false, code: "VOICE_NOT_SYNTHESIZABLE", message: route.reason };
    }

    // Preferred provider first, then the remaining configured adapters in
    // the canonical fallback order — one attempt per provider.
    const ordered = [
      ALL_ADAPTERS[route.preferredProvider]!,
      ...resolveTtsChain().filter((p) => p.id !== route.preferredProvider),
    ].filter((p) => p.configured());

    if (ordered.length === 0) {
      return {
        ok: false,
        code: "NO_TTS_PROVIDER",
        message:
          "No TTS provider is configured. Connect ElevenLabs or OpenAI in Settings → Providers.",
      };
    }

    // Preflight BEFORE any provider call: a denied gate returns the code
    // instead of spending money.
    const preflight = await preflightCreditsCheck(supabaseAdmin, {
      userId,
      workspaceId: data.workspaceId ?? undefined,
      projectId: data.projectId ?? undefined,
      jobType: "tts",
      provider: route.preferredProvider,
      model: route.model,
      characters: data.text.length,
    });
    if (!preflight.ok) {
      return { ok: false, code: preflight.code, message: preflight.message };
    }

    const estimateCredits = preflight.estimate.credits;
    const job = await createGenerationJob(supabaseAdmin, {
      userId,
      workspaceId: data.workspaceId,
      projectId: data.projectId,
      jobType: "voiceover",
      idempotencyKey: data.idempotencyKey,
      maxAttempts: 2,
      costEstimateCredits: estimateCredits,
      provider: route.preferredProvider,
      model: route.model,
    });

    // Idempotent retry: a completed job reuses its stored audio URL.
    const checkpoint = (job.checkpoint ?? {}) as Record<string, unknown>;
    if (job.status === "completed" && typeof checkpoint["audio_url"] === "string") {
      return {
        ok: true,
        jobId: job.id,
        audioUrl: checkpoint["audio_url"],
        durationSeconds: Number(checkpoint["duration_seconds"] ?? 0),
        provider: String(checkpoint["provider"] ?? route.preferredProvider),
        model: typeof checkpoint["model"] === "string" ? checkpoint["model"] : route.model,
        characters: data.text.length,
      };
    }

    const claimed = await claimGenerationJob(
      supabaseAdmin,
      job.id,
      `voice-studio:${userId}:${Date.now()}`,
    );
    if (!claimed) {
      // Another worker/tab owns this job — return a pollable state instead
      // of throwing; the caller retries with the same idempotency key and
      // gets the completed audio URL once the job finishes.
      return {
        ok: false,
        code: "JOB_IN_PROGRESS",
        message:
          "This voiceover job is already being processed. Retry with the same idempotency key to pick up the finished audio.",
      };
    }

    const fail = async (message: string): Promise<VoiceoverJobResult> => {
      await failGenerationJob(supabaseAdmin, job.id, {
        code: "TTS_FAILED",
        message,
        voice_id: data.voiceId,
      });
      return { ok: false, code: "TTS_FAILED", message };
    };

    try {
      // Debit the ESTIMATE idempotently BEFORE the paid call. This is the
      // minute-based ledger (1 credit = 1 finished minute, see
      // src/lib/credits.ts): TTS estimates are converted to whole minutes
      // with Math.ceil inside the RPC. It is the only existing idempotent
      // debit path for generation jobs (per-job ref, balance re-checked
      // atomically, failGenerationJob refunds), so it is the safest choice
      // for TTS until a dedicated credit-amount debit RPC exists.
      await debitMinutesForJob(
        supabaseAdmin,
        userId,
        job.id,
        estimateCredits,
        `Voiceover TTS (${route.preferredProvider}, ~${data.text.length} chars)`,
      );

      const result = await synthesizeSpeechWithFallback(
        data.text,
        { voiceId: route.voiceId, model: route.model },
        {
          providers: ordered,
          costCtx: { admin: supabaseAdmin, userId, projectId: data.projectId ?? null },
          meta: { job_id: job.id, voice_id: data.voiceId },
        },
      );

      if (!result.ok || !result.audio) {
        return await fail(result.error?.message ?? "All TTS providers failed.");
      }

      const path = `${userId}/voiceovers/${job.id}.mp3`;
      const { error: upError } = await supabaseAdmin.storage
        .from("generated-videos")
        .upload(path, result.audio, { contentType: "audio/mpeg", upsert: true });
      if (upError) return await fail(`Could not store the narration audio: ${upError.message}`);

      const { data: signed, error: signError } = await supabaseAdmin.storage
        .from("generated-videos")
        .createSignedUrl(path, 60 * 60 * 24 * 7);
      if (signError || !signed) {
        return await fail(`Could not sign the narration URL: ${signError?.message ?? "unknown"}`);
      }

      // Real measured duration from the MP3 frame headers (falls back to a
      // wpm estimate when the stream can't be parsed).
      const { mp3Duration } = await import("../../providers/voice.server");
      const durationSeconds = Math.max(1, Math.round(mp3Duration(result.audio, data.text)));

      await recordProviderTask(supabaseAdmin, {
        jobId: job.id,
        provider: result.provider,
        model: result.model,
        attempt: 1,
        status: "succeeded",
        latencyMs: result.latencyMs,
        costEstimate: estimateCredits,
        costActual: estimateCredits,
        usage: { characters: result.characters },
        outputRef: path,
      });

      // saveCheckpoint only writes on running/checkpointed rows — write the
      // audio URL BEFORE completing, so the completed-job idempotency path
      // can reuse it via checkpoint.audio_url.
      const { saveCheckpoint } = await import("../../jobs/durable-jobs.server");
      await saveCheckpoint(supabaseAdmin, job.id, {
        audio_url: signed.signedUrl,
        duration_seconds: durationSeconds,
        provider: result.provider,
        model: result.model,
      });
      // completeGenerationJob sums provider_tasks.cost_actual into
      // cost_actual_credits — the measured cost was recorded there above, so
      // no costActualCredits param here (passing it would double-count).
      await completeGenerationJob(supabaseAdmin, job.id);

      return {
        ok: true,
        jobId: job.id,
        audioUrl: signed.signedUrl,
        durationSeconds,
        provider: result.provider,
        model: result.model,
        characters: result.characters,
      };
    } catch (err) {
      return await fail(err instanceof Error ? err.message : "Voiceover job failed.");
    }
  });

/** Whether any TTS provider is configured (drives studio empty states). */
export const getTtsAvailability = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => ({ available: ttsAvailable() }));
