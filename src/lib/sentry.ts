/**
 * Sentry error tracking, env-gated. Nothing happens until a DSN is set:
 *   - client: VITE_SENTRY_DSN
 *
 * The Sentry SDK is NEVER imported at module top-level. The
 * @sentry/tanstackstart-react SDK crashes Cloudflare Workers at import time
 * (TypeError: init_globalthis is not a function), which takes down the entire
 * site. It is loaded via dynamic import only in the browser, only when a DSN
 * is configured. Server-side Sentry is disabled until a worker-compatible
 * SDK (@sentry/cloudflare) is integrated.
 *
 * The app must behave identically without Sentry.
 */

let clientReady = false;
let sentryModule: typeof import("@sentry/tanstackstart-react") | undefined;

/** Initialize Sentry in the browser. Call once from the root component. */
export function initClientSentry(): void {
  if (clientReady || typeof window === "undefined") return;
  const dsn = import.meta.env["VITE_SENTRY_DSN"] as string | undefined;
  if (!dsn) return;
  // Dynamic import: keeps the SDK out of the SSR/worker bundle entirely.
  import("@sentry/tanstackstart-react")
    .then((Sentry) => {
      sentryModule = Sentry;
      Sentry.init({
        dsn,
        environment: (import.meta.env["MODE"] as string | undefined) ?? "production",
        // Keep the default browser tracing off; error tracking only for now.
        tracesSampleRate: 0,
      });
      clientReady = true;
    })
    .catch(() => {
      // Error reporting must never break the app.
    });
}

export function sentryEnabled(): boolean {
  return clientReady;
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
    if (!sentryModule || !clientReady) return;
    const Sentry = sentryModule;
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
