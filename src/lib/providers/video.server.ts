/**
 * Complete Video Mode provider registry + config-driven fallback chain.
 *
 * VIDEO_PROVIDERS is the ordered chain of REGISTERED video adapters —
 * fal.ai is the primary today (single-provider risk documented in
 * docs/AI_ARCHITECTURE.md). A founder can register a second real adapter
 * here and name it via the VIDEO_FALLBACK_PROVIDER env var; the chain then
 * fails over gracefully. With no key configured nothing makes a network call.
 *
 * Paid-call discipline: generateVideoWithFallback makes ONE attempt per
 * provider, then stops — a failed paid call is never retried blindly, and a
 * missing fallback returns the honest error envelope instead of fake success.
 */
import type { ProviderResult } from "./contracts";
import { withProviderTelemetry } from "./telemetry.server";
import type { CostCtx } from "../api-cost";

export interface VideoProvider {
  id: string;
  label: string;
  envKey: string;
  configured(): boolean;
  generateClip(prompt: string, seconds: number): Promise<string>;
}

function notConfigured(label: string): never {
  throw new Error(`${label} is not configured — Complete Video Mode is still coming soon.`);
}

export const falProvider: VideoProvider = {
  id: "fal",
  label: "fal.ai",
  envKey: "FAL_API_KEY",
  configured: () => Boolean(process.env["FAL_API_KEY"]),
  async generateClip() {
    return notConfigured("fal.ai");
  },
};

/** Ordered chain of registered video adapters. fal.ai is the primary. */
export const VIDEO_PROVIDERS: VideoProvider[] = [falProvider];

/**
 * Env-driven fallback selection. VIDEO_FALLBACK_PROVIDER names a REGISTERED
 * adapter id (see VIDEO_PROVIDERS). Unknown ids are ignored (fail closed —
 * never route a paid call to a phantom provider).
 */
export function videoFallbackId(): string | null {
  const id = process.env["VIDEO_FALLBACK_PROVIDER"];
  return id && id.trim().length > 0 ? id.trim() : null;
}

/** Full ordered chain: registered providers first, then the env-named fallback. */
export function resolveVideoChain(): VideoProvider[] {
  const chain = [...VIDEO_PROVIDERS];
  const fallbackId = videoFallbackId();
  if (fallbackId) {
    const fallback = VIDEO_PROVIDERS.find((p) => p.id === fallbackId);
    if (fallback && !chain.includes(fallback)) chain.push(fallback);
    else if (!fallback) {
      console.warn(
        `[vidora] VIDEO_FALLBACK_PROVIDER="${fallbackId}" names no registered video adapter — ignoring.`,
      );
    }
  }
  return chain;
}

export function videoModeAvailable(): boolean {
  return VIDEO_PROVIDERS.some((p) => p.configured());
}

export type VideoGenerationOptions = {
  /**
   * Override the provider chain. Tests inject fake adapters here; production
   * always resolves from resolveVideoChain(). Fakes must never appear in
   * prod code — only test files may pass this option.
   */
  providers?: VideoProvider[] | undefined;
  /** When set and a call succeeds, one row is recorded to api_usage. */
  costCtx?: CostCtx | null | undefined;
};

/**
 * Tries each configured provider in chain order, one attempt per provider.
 * Returns the first success; if every provider fails (or none is
 * configured) returns the honest error/unconfigured envelope — never fake
 * success, never a blind retry of a paid call.
 */
export async function generateVideoWithFallback(
  prompt: string,
  seconds: number,
  opts: VideoGenerationOptions = {},
): Promise<ProviderResult<string>> {
  const chain = (opts.providers ?? resolveVideoChain()).filter((p) => p.configured());

  let lastError: ProviderResult<string> | null = null;
  for (const provider of chain) {
    const result = await withProviderTelemetry(() => provider.generateClip(prompt, seconds), {
      provider: provider.id,
      operation: "video_generate",
      model: null,
      configured: true,
      // Video pricing varies by model/length and no provider publishes a
      // stable per-call USD figure here — no fabricated estimate.
      usage: { seconds },
      costCtx: opts.costCtx ?? null,
    });
    if (result.ok) return result;
    lastError = result;
    // One attempt per provider — move on to the next configured adapter.
  }

  if (lastError) return lastError;
  return {
    ok: false,
    output: null,
    model: null,
    taskId: null,
    latencyMs: 0,
    estimatedCost: null,
    actualCost: null,
    costCurrency: "credits",
    status: "unconfigured",
    error: {
      code: "unconfigured",
      message:
        "No video provider is configured — Complete Video Mode is still coming soon. " +
        "Add FAL_API_KEY (and optionally VIDEO_FALLBACK_PROVIDER) to enable it.",
    },
    usage: { seconds },
  };
}
