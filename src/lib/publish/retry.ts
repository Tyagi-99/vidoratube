/**
 * Phase 4, Stream A — transient-only retry with exponential backoff.
 *
 * Platform API calls (YouTube Data API, Meta Graph API) fail transiently:
 * 429 rate limits, 5xx, dropped sockets. Retrying those is correct; retrying
 * a 400/401/403/404 or a validation error is not — it burns quota and can
 * double-publish. This module retries ONLY transient failures.
 *
 * Pure (no I/O): the sleep function is injectable so tests run instantly.
 */

export type SleepFn = (ms: number) => Promise<void>;

const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * True when the failure is worth retrying: HTTP 429 or 5xx, or a network/
 * timeout-level error from fetch. Everything else (4xx, validation,
 * auth, not-found) returns false — those must surface immediately.
 */
export function isTransientError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  // HTTP statuses embedded in platform error messages ("HTTP 503", "(503)",
  // "429", Meta "error_subcode", etc.).
  if (/\b(429|5\d{2})\b/.test(message)) return true;
  // fetch-level network failures.
  if (
    /network error|fetch failed|failed to fetch|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|timed? ?out|temporarily unavailable|service unavailable/i.test(
      message,
    )
  )
    return true;
  return false;
}

export interface RetryOptions {
  /** Total attempts including the first (default 3). */
  maxAttempts?: number | undefined;
  /** First backoff delay in ms (default 1000); doubles each attempt. */
  baseMs?: number | undefined;
  /** Backoff cap in ms (default 15000). */
  maxMs?: number | undefined;
  /** Injectable clock (default setTimeout). */
  sleep?: SleepFn | undefined;
  /**
   * Randomness source for jitter (default Math.random). Injectable so tests
   * are deterministic.
   */
  random?: (() => number) | undefined;
}

/**
 * Runs fn, retrying transient failures with exponential backoff + jitter.
 * Non-transient failures throw immediately without a retry. After the final
 * attempt the last error is rethrown unchanged.
 */
export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(opts.maxAttempts ?? 3));
  const baseMs = opts.baseMs ?? 1000;
  const maxMs = opts.maxMs ?? 15000;
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientError(error) || attempt === maxAttempts) throw error;
      const backoff = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
      const jitter = random() * 0.25 * backoff;
      await sleep(backoff + jitter);
    }
  }
  // Unreachable (loop always returns or throws), but keeps tsc honest.
  throw lastError;
}
