/**
 * Integration test for the `runVoiceoverJob` orchestration
 * (src/lib/creation/voice/voice.functions.ts).
 *
 * Mocks the server boundary (createServerFn middleware, durable jobs,
 * credit preflight, storage, provider chain) and drives the real handler
 * with a fake request context. No real provider APIs, no network, no paid
 * calls — every paid path is a vi.fn().
 *
 * Asserts the paid-safety contract:
 *   - preflight denial → result code, ZERO provider/debit/job calls
 *   - no configured provider → NO_TTS_PROVIDER before preflight
 *   - happy path → one chain attempt, cost recorded exactly once
 *     (provider_tasks.cost_actual only — completeGenerationJob gets no
 *     costActualCredits), checkpoint written BEFORE completion
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => {
  const chain: Record<string, (...args: never[]) => unknown> = {};
  chain["middleware"] = () => chain;
  chain["inputValidator"] = () => chain;
  chain["handler"] = (fn: (...args: never[]) => unknown) => fn;
  return {
    createServerFn: () => chain,
    // Passthrough so auth-middleware loads; our chain mock ignores it.
    createMiddleware: () => ({ server: (fn: unknown) => fn }),
  };
});

const mocks = vi.hoisted(() => ({
  synthesizeSpeechWithFallback: vi.fn(),
  resolveTtsChain: vi.fn(),
  createGenerationJob: vi.fn(),
  claimGenerationJob: vi.fn(),
  recordProviderTask: vi.fn(),
  completeGenerationJob: vi.fn(),
  failGenerationJob: vi.fn(),
  saveCheckpoint: vi.fn(),
  preflightCreditsCheck: vi.fn(),
  debitMinutesForJob: vi.fn(),
  mp3Duration: vi.fn(),
  storageUpload: vi.fn(),
  storageSign: vi.fn(),
  elevenlabs: { id: "elevenlabs", label: "ElevenLabs", configured: (): boolean => true },
  openai: { id: "openai", label: "OpenAI TTS", configured: (): boolean => true },
  gateway: { id: "gateway", label: "Gateway", configured: (): boolean => true },
}));

vi.mock("./chain.server", () => ({
  elevenLabsTtsProvider: mocks.elevenlabs,
  openAiTtsProvider: mocks.openai,
  gatewayTtsProvider: mocks.gateway,
  resolveTtsChain: mocks.resolveTtsChain,
  synthesizeSpeechWithFallback: mocks.synthesizeSpeechWithFallback,
  ttsAvailable: () => true,
}));

vi.mock("../../jobs/durable-jobs.server", () => ({
  createGenerationJob: mocks.createGenerationJob,
  claimGenerationJob: mocks.claimGenerationJob,
  recordProviderTask: mocks.recordProviderTask,
  completeGenerationJob: mocks.completeGenerationJob,
  failGenerationJob: mocks.failGenerationJob,
  saveCheckpoint: mocks.saveCheckpoint,
}));

vi.mock("../../credits/preflight.server", () => ({
  preflightCreditsCheck: mocks.preflightCreditsCheck,
}));

vi.mock("@/lib/credits", () => ({
  debitMinutesForJob: mocks.debitMinutesForJob,
}));

vi.mock("../../providers/voice.server", () => ({
  elevenLabsConfigured: () => true,
  mp3Duration: mocks.mp3Duration,
}));

vi.mock("../../providers/openai-tts.server", () => ({
  openAiTtsConfigured: () => true,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        upload: mocks.storageUpload,
        createSignedUrl: mocks.storageSign,
      }),
    },
  },
}));

import { runVoiceoverJob } from "./voice.functions";
import type { VoiceoverJobInput, VoiceoverJobResult } from "./types";

/**
 * The createServerFn mock above returns the raw handler, so drive it
 * directly with a fake request context. The cast is test-only.
 */
const runJob = runVoiceoverJob as unknown as (args: {
  data: VoiceoverJobInput;
  context: { supabase: never; userId: string };
}) => Promise<VoiceoverJobResult>;

const USER_VOICE_ROW = {
  id: "voice-1",
  user_id: "u1",
  name: "Narrator",
  provider: "elevenlabs",
  provider_voice_id: "vid123",
  voice_type: "builtin",
  language_code: "en",
  verified: true,
  is_clone_legal: false,
  metadata: null,
  created_at: "2026-09-28T00:00:00Z",
  updated_at: "2026-09-28T00:00:00Z",
};

function fakeSupabase(voiceRow: typeof USER_VOICE_ROW | null) {
  const q: Record<string, (...args: unknown[]) => unknown> = {};
  q["from"] = () => q;
  q["select"] = () => q;
  q["eq"] = () => q;
  q["order"] = () => q;
  q["maybeSingle"] = async () => ({ data: voiceRow, error: null });
  return q as never;
}

const ctx = (voiceRow: typeof USER_VOICE_ROW | null) => ({
  supabase: fakeSupabase(voiceRow),
  userId: "u1",
});

const input = {
  voiceId: "voice-1",
  text: "Hello world, this is a test narration.",
  workspaceId: null,
  projectId: null,
  idempotencyKey: "idem-1",
};

const okChainResult = {
  ok: true as const,
  audio: new Uint8Array([0x49, 0x44, 0x33, 0x04]),
  provider: "elevenlabs",
  model: "eleven_v4",
  latencyMs: 1200,
  characters: 38,
  unitCostUsd: 0.0001,
  error: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveTtsChain.mockReturnValue([mocks.elevenlabs, mocks.openai, mocks.gateway]);
  mocks.preflightCreditsCheck.mockResolvedValue({
    ok: true,
    estimate: { credits: 3 },
    balance: 100,
    warnings: [],
  });
  mocks.createGenerationJob.mockResolvedValue({
    id: "job-1",
    status: "queued",
    checkpoint: {},
  });
  mocks.claimGenerationJob.mockResolvedValue({ id: "job-1", status: "running" });
  mocks.synthesizeSpeechWithFallback.mockResolvedValue(okChainResult);
  mocks.mp3Duration.mockReturnValue(12.4);
  mocks.storageUpload.mockResolvedValue({ error: null });
  mocks.storageSign.mockResolvedValue({
    data: { signedUrl: "https://signed.example/audio.mp3" },
    error: null,
  });
  mocks.saveCheckpoint.mockResolvedValue(null);
  mocks.completeGenerationJob.mockResolvedValue({ id: "job-1", status: "completed" });
  mocks.recordProviderTask.mockResolvedValue(null);
  mocks.debitMinutesForJob.mockResolvedValue(undefined);
  mocks.failGenerationJob.mockImplementation(
    async (_admin: unknown, jobId: string, err: unknown) => {
      void jobId;
      return {
        ok: false,
        code: "TTS_FAILED",
        message: String((err as { message: string }).message),
      };
    },
  );
});

describe("runVoiceoverJob orchestration", () => {
  it("preflight denial returns the code with ZERO paid calls", async () => {
    mocks.preflightCreditsCheck.mockResolvedValue({
      ok: false,
      code: "INSUFFICIENT_CREDITS",
      message: "Not enough credits.",
    });
    const res = await runJob({ data: input, context: ctx(USER_VOICE_ROW) });
    expect(res).toEqual({
      ok: false,
      code: "INSUFFICIENT_CREDITS",
      message: "Not enough credits.",
    });
    expect(mocks.createGenerationJob).not.toHaveBeenCalled();
    expect(mocks.debitMinutesForJob).not.toHaveBeenCalled();
    expect(mocks.synthesizeSpeechWithFallback).not.toHaveBeenCalled();
  });

  it("returns NO_TTS_PROVIDER before preflight when nothing is configured", async () => {
    mocks.elevenlabs.configured = () => false;
    mocks.openai.configured = () => false;
    mocks.gateway.configured = () => false;
    mocks.resolveTtsChain.mockReturnValue([]);
    try {
      const res = await runJob({ data: input, context: ctx(USER_VOICE_ROW) });
      expect(res).toEqual({
        ok: false,
        code: "NO_TTS_PROVIDER",
        message: expect.stringContaining("No TTS provider is configured"),
      });
      expect(mocks.preflightCreditsCheck).not.toHaveBeenCalled();
      expect(mocks.synthesizeSpeechWithFallback).not.toHaveBeenCalled();
    } finally {
      mocks.elevenlabs.configured = () => true;
      mocks.openai.configured = () => true;
      mocks.gateway.configured = () => true;
    }
  });

  it("returns VOICE_NOT_FOUND without touching preflight or providers", async () => {
    const res = await runJob({ data: input, context: ctx(null) });
    expect(res).toEqual({
      ok: false,
      code: "VOICE_NOT_FOUND",
      message: expect.any(String),
    });
    expect(mocks.preflightCreditsCheck).not.toHaveBeenCalled();
    expect(mocks.synthesizeSpeechWithFallback).not.toHaveBeenCalled();
  });

  it("rejects uploaded samples and unconfirmed clones without synthesizing", async () => {
    const uploaded = { ...USER_VOICE_ROW, voice_type: "uploaded", provider: "upload" };
    const res = await runJob({ data: input, context: ctx(uploaded) });
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ code: "VOICE_NOT_SYNTHESIZABLE" });
    expect(mocks.synthesizeSpeechWithFallback).not.toHaveBeenCalled();

    const clone = { ...USER_VOICE_ROW, voice_type: "cloned", is_clone_legal: false };
    const res2 = await runJob({ data: input, context: ctx(clone) });
    expect(res2).toMatchObject({ code: "VOICE_NOT_SYNTHESIZABLE" });
    expect(mocks.synthesizeSpeechWithFallback).not.toHaveBeenCalled();
  });

  it("happy path: one chain attempt, cost recorded exactly once, checkpoint before completion", async () => {
    const res = await runJob({ data: input, context: ctx(USER_VOICE_ROW) });

    expect(res).toEqual({
      ok: true,
      jobId: "job-1",
      audioUrl: "https://signed.example/audio.mp3",
      durationSeconds: 12,
      provider: "elevenlabs",
      model: "eleven_v4",
      characters: 38,
    });

    // Exactly one chain attempt with the preferred provider first.
    expect(mocks.synthesizeSpeechWithFallback).toHaveBeenCalledTimes(1);
    const chainCall = mocks.synthesizeSpeechWithFallback.mock.calls[0]!;
    expect(chainCall[1]).toMatchObject({ voiceId: "vid123", model: "eleven_v4" });
    expect(chainCall[2].providers[0]).toBe(mocks.elevenlabs);

    // Debit happened before the paid call.
    expect(mocks.debitMinutesForJob).toHaveBeenCalledTimes(1);

    // Cost recorded exactly once: provider_tasks.cost_actual only.
    // completeGenerationJob must NOT receive costActualCredits (it sums
    // provider_tasks.cost_actual itself — passing both would double-count).
    expect(mocks.recordProviderTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ jobId: "job-1", costActual: 3, status: "succeeded" }),
    );
    expect(mocks.completeGenerationJob).toHaveBeenCalledTimes(1);
    expect(mocks.completeGenerationJob.mock.calls[0]!.length).toBe(2);

    // Checkpoint (carries the audio URL for idempotent retries) is written
    // BEFORE the job completes, because saveCheckpoint refuses terminal rows.
    const saveOrder = mocks.saveCheckpoint.mock.invocationCallOrder[0] ?? -1;
    const completeOrder = mocks.completeGenerationJob.mock.invocationCallOrder[0] ?? -1;
    expect(saveOrder).toBeLessThan(completeOrder);
    expect(mocks.saveCheckpoint).toHaveBeenCalledWith(
      expect.anything(),
      "job-1",
      expect.objectContaining({ audio_url: "https://signed.example/audio.mp3" }),
    );
  });

  it("completed job reuses the stored audio URL (idempotent retry, no paid work)", async () => {
    mocks.createGenerationJob.mockResolvedValue({
      id: "job-1",
      status: "completed",
      checkpoint: { audio_url: "https://signed.example/old.mp3", provider: "openai" },
    });
    const res = await runJob({ data: input, context: ctx(USER_VOICE_ROW) });
    expect(res).toEqual({
      ok: true,
      jobId: "job-1",
      audioUrl: "https://signed.example/old.mp3",
      durationSeconds: 0,
      provider: "openai",
      model: "eleven_v4",
      characters: input.text.length,
    });
    expect(mocks.synthesizeSpeechWithFallback).not.toHaveBeenCalled();
    expect(mocks.debitMinutesForJob).not.toHaveBeenCalled();
  });

  it("chain failure marks the job failed and returns TTS_FAILED", async () => {
    mocks.synthesizeSpeechWithFallback.mockResolvedValue({
      ok: false,
      audio: null,
      provider: "elevenlabs",
      model: null,
      latencyMs: 50,
      characters: 38,
      unitCostUsd: null,
      error: { code: "PROVIDER_ERROR", message: "boom" },
    });
    const res = await runJob({ data: input, context: ctx(USER_VOICE_ROW) });
    expect(res).toMatchObject({ ok: false, code: "TTS_FAILED" });
    expect(mocks.failGenerationJob).toHaveBeenCalledTimes(1);
    expect(mocks.completeGenerationJob).not.toHaveBeenCalled();
  });

  it("job claimed elsewhere returns JOB_IN_PROGRESS (pollable, not a throw)", async () => {
    mocks.claimGenerationJob.mockResolvedValue(null);
    const res = await runJob({ data: input, context: ctx(USER_VOICE_ROW) });
    expect(res).toEqual({
      ok: false,
      code: "JOB_IN_PROGRESS",
      message: expect.stringContaining("idempotency key"),
    });
    expect(mocks.synthesizeSpeechWithFallback).not.toHaveBeenCalled();
  });
});
