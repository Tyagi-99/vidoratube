/**
 * Sentry error tracking, env-gated. Nothing happens until a DSN is set:
 *   - client: VITE_SENTRY_DSN
 *   - server: SENTRY_DSN_SERVER (falls back to SENTRY_DSN)
 * The app must behave identically without Sentry.
 */

import * as Sentry from "@sentry/tanstackstart-react";

let clientReady = false;
let serverReady = false;

/** Initialize Sentry in the browser. Call once from the root component. */
export function initClientSentry(): void {
  if (clientReady || typeof window === "undefined") return;
  const dsn = import.meta.env["VITE_SENTRY_DSN"] as string | undefined;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: import.meta.env["MODE"] ?? "production",
    // Keep the default browser tracing off; error tracking only for now.
    tracesSampleRate: 0,
  });
  clientReady = true;
}

/** Initialize Sentry on the server. Call once from src/server.ts. */
export function initServerSentry(): void {
  if (serverReady) return;
  // Guard: on Cloudflare Workers without nodejs_compat, `process` is undefined
  // and accessing process.env throws ReferenceError at module load — which
  // crashes the entire worker. This runs at import time in src/server.ts.
  const env = typeof process !== "undefined" ? process.env : undefined;
  const dsn = env?.["SENTRY_DSN_SERVER"] ?? env?.["SENTRY_DSN"];
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: env?.["NODE_ENV"] ?? "production",
    tracesSampleRate: 0,
  });
  serverReady = true;
}

export function sentryEnabled(): boolean {
  return clientReady || serverReady;
}

/**
 * Report an error with job/user context. Never throws; no-op without a DSN.
 * Only ids are attached — never emails, names, scripts, or video content.
 */
export function captureError(
  error: unknown,
  context?: { job_id?: string; user_id?: string; extra?: Record<string, string> },
): void {
  try {
    if (!sentryEnabled()) return;
    Sentry.withScope((scope) => {
      if (context?.job_id) scope.setTag("job_id", context.job_id);
      if (context?.user_id) scope.setUser({ id: context.user_id });
      if (context?.extra) scope.setExtras(context.extra);
      Sentry.captureException(error);
    });
  } catch {
    // Error reporting must never break the app.
  }
}

/**
 * Throw this in /admin to verify Sentry end-to-end. It is caught by the
 * admin test button, reported via captureError, and re-surfaced as a toast.
 */
export function sentryTestError(): Error {
  const error = new Error("Sentry test error from Vidora admin");
  error.name = "SentryTestError";
  return error;
}
