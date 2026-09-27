/**
 * Provider telemetry boundary: wraps any provider call in the standard
 * {@link ProviderResult} envelope.
 *
 * Guarantees:
 * - latency is always measured (wall clock around the call);
 * - errors are captured into the envelope — the helper NEVER throws past
 *   this boundary (a provider failure is data, not a crash);
 * - `configured: false` short-circuits to the honest `status: "unconfigured"`
 *   envelope without invoking the provider at all;
 * - when an estimate + cost context are supplied, the measured cost is
 *   recorded to `api_usage` via the existing recordApiCost path, carrying
 *   model / task id / latency in meta.
 */
import type { CostCtx } from "../api-cost";
import { recordApiCost } from "../api-cost";
import type { ProviderErrorInfo, ProviderResult, ProviderStatus } from "./contracts";
import { ProviderError } from "./http.server";

export type CostEstimate = {
  /** Billable units: characters, tokens, images, ... */
  units: number;
  /** Real USD cost per unit (see api-cost.ts pricing sources). */
  unitCostUsd: number;
};

export type TelemetryOptions = {
  provider: string;
  operation: string;
  model?: string | null | undefined;
  taskId?: string | null | undefined;
  /**
   * Pass the adapter's configured() result. When false the provider is never
   * invoked and the envelope reports status "unconfigured".
   */
  configured?: boolean | undefined;
  /** When set, estimated/actual cost are computed as units * unitCostUsd. */
  estimate?: CostEstimate | null | undefined;
  /** Measured billable facts attached to the envelope. */
  usage?: Record<string, number | string> | undefined;
  /** Extra fields merged into the api_usage row's meta. */
  meta?: Record<string, unknown> | undefined;
  /** When set and the call succeeds, one row is recorded to api_usage. */
  costCtx?: CostCtx | null | undefined;
};

function classifyError(error: unknown): {
  code: string;
  status: ProviderStatus;
  message: string;
} {
  const message = error instanceof Error ? error.message : String(error ?? "unknown error");
  const lower = message.toLowerCase();

  if (error instanceof ProviderError) {
    if (error.status === 429) return { code: "rate_limited", status: "error", message };
    if (error.status === 401 || error.status === 403)
      return { code: "auth", status: "error", message };
    if (error.status === 402) return { code: "credits_exhausted", status: "error", message };
    if (error.status === 0 && lower.includes("timed out"))
      return { code: "timeout", status: "error", message };
    return { code: "provider_error", status: "error", message };
  }
  if (/not configured|no .*key|missing .*key|api key/i.test(message)) {
    return { code: "unconfigured", status: "unconfigured", message };
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return { code: "timeout", status: "error", message };
  }
  return { code: "unknown", status: "error", message };
}

function unconfiguredEnvelope<T>(opts: TelemetryOptions): ProviderResult<T> {
  return {
    ok: false,
    output: null,
    model: opts.model ?? null,
    taskId: opts.taskId ?? null,
    latencyMs: 0,
    estimatedCost: null,
    actualCost: null,
    costCurrency: "credits",
    status: "unconfigured",
    error: {
      code: "unconfigured",
      message: `${opts.provider} is not configured — no output was produced.`,
    } satisfies ProviderErrorInfo,
    usage: opts.usage ?? {},
  };
}

export async function withProviderTelemetry<T>(
  fn: () => Promise<T>,
  opts: TelemetryOptions,
): Promise<ProviderResult<T>> {
  if (opts.configured === false) return unconfiguredEnvelope<T>(opts);

  const started = Date.now();
  const model = opts.model ?? null;
  const taskId = opts.taskId ?? null;
  const usage = opts.usage ?? {};

  try {
    const output = await fn();
    const latencyMs = Date.now() - started;
    const estimate = opts.estimate ?? null;
    const estimatedCost = estimate ? estimate.units * estimate.unitCostUsd : null;

    if (opts.costCtx && estimate && estimatedCost !== null) {
      try {
        await recordApiCost(opts.costCtx.admin, {
          userId: opts.costCtx.userId,
          projectId: opts.costCtx.projectId ?? null,
          provider: opts.provider,
          operation: opts.operation,
          units: estimate.units,
          unitCostUsd: estimate.unitCostUsd,
          meta: {
            ...(opts.meta ?? {}),
            model: model ?? undefined,
            task_id: taskId ?? undefined,
            latency_ms: latencyMs,
          },
        });
      } catch {
        // Cost recording must never break the product flow (recordApiCost
        // already swallows its own failures; this is belt and braces).
      }
    }

    return {
      ok: true,
      output,
      model,
      taskId,
      latencyMs,
      estimatedCost,
      actualCost: estimatedCost,
      costCurrency: "credits",
      status: "ok",
      error: null,
      usage,
    };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const classified = classifyError(error);
    return {
      ok: false,
      output: null,
      model,
      taskId,
      latencyMs,
      estimatedCost: null,
      actualCost: null,
      costCurrency: "credits",
      status: classified.status,
      error: { code: classified.code, message: classified.message },
      usage,
    };
  }
}
