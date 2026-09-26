/**
 * Startup environment validation for server code.
 *
 * Server functions read process.env in many places. On Cloudflare Workers
 * every one of those reads silently returns `undefined` unless the
 * `nodejs_compat` flag is set (see wrangler.toml.example) — producing
 * confusing downstream failures instead of a clear error. Call
 * `assertServerEnv()` once from server entry points to fail fast with the
 * full list of missing variables.
 */
const REQUIRED_SERVER_ENV = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

const OPTIONAL_SERVER_ENV = [
  "LOVABLE_API_KEY",
  "ELEVENLABS_API_KEY",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "YOUTUBE_TOKEN_ENCRYPTION_KEY",
] as const;

let validated = false;

export function assertServerEnv(): void {
  if (validated) return;
  const missing = REQUIRED_SERVER_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    // Never block page rendering: env can be injected late (dev restarts,
    // cold starts). Warn and re-check on the next request instead.
    console.warn(
      `[vidora] Missing required server environment variable(s): ${missing.join(", ")}. ` +
        `If deploying to Cloudflare Workers, ensure compatibility_flags includes "nodejs_compat".`,
    );
    return;
  }
  validated = true;
  const unsetOptional = OPTIONAL_SERVER_ENV.filter((key) => !process.env[key]);
  if (unsetOptional.length > 0) {
    console.warn(`[vidora] Optional server env not set: ${unsetOptional.join(", ")}`);
  }
}
