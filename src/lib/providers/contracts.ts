/**
 * Provider abstractions for Vidora's rights-aware workflow.
 * Existing adapters (stock / image / voice / youtube) should implement or wrap these.
 * VideoSourceProvider must NEVER download YouTube in v1 — only uploads + approved stock.
 *
 * Telemetry: every provider call returns a {@link ProviderResult} envelope
 * (built by `withProviderTelemetry` in telemetry.server.ts). The envelope
 * carries model/task id/latency/cost facts next to the output so callers and
 * the api_usage ledger always see the same numbers.
 */
import type { CostCtx } from "../api-cost";

export type ProviderHealth = {
  id: string;
  label: string;
  configured: boolean;
};

/** Terminal state of a provider call. */
export type ProviderStatus = "ok" | "error" | "unconfigured";

export type ProviderErrorInfo = {
  code: string;
  message: string;
};

/**
 * Standard envelope EVERY provider call returns.
 *
 * - `ok` false + `status: "unconfigured"` means the provider has no key — the
 *   caller must degrade gracefully, never invent the output.
 * - `estimatedCost`/`actualCost` are in USD-equivalent reference units unless
 *   a provider documents otherwise; both are null when the price is unknown
 *   (never fabricate a price). `costCurrency` is fixed to "credits" because
 *   all provider spend is debited from the user's credit ledger.
 * - `usage` holds measured billable facts (characters, tokens, images, ...).
 */
export type ProviderResult<T> = {
  ok: boolean;
  output: T | null;
  model: string | null;
  taskId: string | null;
  latencyMs: number;
  estimatedCost: number | null;
  actualCost: number | null;
  costCurrency: "credits";
  status: ProviderStatus;
  error: ProviderErrorInfo | null;
  usage: Record<string, number | string>;
};

export type ContentMetadata = {
  platform: string;
  platformId: string | null;
  canonicalUrl: string;
  title: string | null;
  description: string | null;
  creatorName: string | null;
  creatorProfileUrl: string | null;
  uploadedAt: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  language: string | null;
  tags: string[];
  /** Raw provider payload facts — never invent metrics */
  metrics: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    followers: number | null;
  };
  raw: unknown;
};

/** Official/public metadata lookup (YouTube Data API first). */
export interface MetadataProvider {
  id: string;
  label: string;
  configured(): boolean;
  resolve(canonicalUrl: string): Promise<ContentMetadata | null>;
}

/** Discovery / search across platforms that allow official APIs. */
export interface SearchProvider {
  id: string;
  label: string;
  configured(): boolean;
  search(
    query: string,
    options?: { maxResults?: number | undefined; costCtx?: CostCtx | null | undefined },
  ): Promise<ProviderResult<ContentMetadata[]>>;
}

export type AcquiredAsset = {
  origin: "user_upload" | "stock" | "generated";
  provider: string;
  storagePath: string | null;
  sourceUrl: string | null;
  mimeType: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  rightsBasis: string;
};

/**
 * Compliant asset intake only.
 * v1: user-uploaded owned/licensed files or approved stock — not YouTube downloads.
 */
export interface VideoSourceProvider {
  id: string;
  label: string;
  configured(): boolean;
  /** Explicit capability flag so callers never assume download support */
  supportsYouTubeDownload: false;
}

export interface LLMProvider {
  id: string;
  label: string;
  configured(): boolean;
  completeJson<T>(system: string, user: string): Promise<T>;
}

export interface VoiceProvider {
  id: string;
  label: string;
  configured(): boolean;
  synthesize(text: string, voiceId: string, model?: string): Promise<ArrayBuffer>;
}

export type TranscriptWord = { start: number; end: number; text: string };

export type TranscriptResult = {
  text: string;
  words: TranscriptWord[];
};

export interface TranscriptionProvider {
  id: string;
  label: string;
  configured(): boolean;
  /**
   * Transcribe audio reachable at `audioUrl` (a short-lived signed URL works).
   * Always returns the {@link ProviderResult} envelope: `status: "unconfigured"`
   * when no key is set — never a fabricated transcript.
   */
  transcribe(audioUrl: string): Promise<ProviderResult<TranscriptResult>>;
}

export interface StorageProvider {
  id: string;
  label: string;
  configured(): boolean;
  /** Return a short-lived access URL for a private storage path */
  createSignedUrl(path: string, expiresInSeconds: number): Promise<string>;
}

export interface PublishingProvider {
  id: string;
  label: string;
  configured(): boolean;
}

/** Mode 3 auto-edit planner — see src/lib/mode3/provider.ts for the active contract. */
export type {
  AutomaticEditingProvider,
  AutoEditPlan,
  AutoEditPlanInput,
} from "@/lib/mode3/provider";
