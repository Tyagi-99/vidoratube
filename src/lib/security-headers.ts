/**
 * Security headers applied to every response from the TanStack Start server.
 *
 * CSP notes (documented so future changes don't silently break the app):
 * - `script-src 'unsafe-inline'` is required: __root.tsx injects a theme-init
 *   inline <script> (avoids dark-mode flash), and TanStack Start serializes
 *   router state into inline scripts during SSR hydration.
 * - `style-src 'unsafe-inline'` is required: Tailwind/shadcn emit inline styles
 *   and <style> blocks.
 * - `img-src https:` is intentionally broad: scene images come from Pexels,
 *   Pixabay, YouTube thumbnails, the Lovable AI gateway and Supabase storage.
 * - `worker-src blob:` + `media-src blob:` are required by FFmpeg.wasm
 *   (vendored under /wasm, workers + blob URLs for previews/renders).
 * - `connect-src` covers browser-initiated fetches only: Supabase REST/Realtime
 *   (wildcarded so the project ref can change), our own API routes, and the
 *   Google OAuth/API endpoints used during YouTube connect. Server-to-provider
 *   calls (ElevenLabs, Lovable gateway) happen in .server.ts modules and are
 *   not subject to CSP.
 * - Razorpay checkout (INR payments, /billing) injects
 *   https://checkout.razorpay.com/v1/checkout.js, which renders its payment UI
 *   in an iframe from https://api.razorpay.com — both are allowlisted below.
 *   Stripe uses server-side redirect checkout (no client SDK), so no Stripe
 *   script source is needed.
 */

const SUPABASE_HOSTS = "https://*.supabase.co wss://*.supabase.co";

const CSP_DIRECTIVES: Record<string, string[]> = {
  "default-src": ["'self'"],
  "base-uri": ["'self'"],
  "object-src": ["'none'"],
  "frame-ancestors": ["'none'"],
  "form-action": ["'self'", "https://accounts.google.com"],
  "script-src": ["'self'", "'unsafe-inline'", "https://checkout.razorpay.com"],
  "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
  "img-src": ["'self'", "data:", "blob:", "https:"],
  "media-src": ["'self'", "data:", "blob:", "https:"],
  "worker-src": ["'self'", "blob:"],
  "connect-src": [
    "'self'",
    SUPABASE_HOSTS,
    "https://accounts.google.com",
    "https://oauth2.googleapis.com",
    "https://www.googleapis.com",
    "https://api.razorpay.com",
  ],
  "frame-src": ["https://www.youtube.com", "https://api.razorpay.com"],
};

export function buildContentSecurityPolicy(): string {
  return Object.entries(CSP_DIRECTIVES)
    .map(([directive, sources]) => `${directive} ${sources.join(" ")}`)
    .join("; ");
}

export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": buildContentSecurityPolicy(),
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

/**
 * Returns a copy of the response with security headers applied.
 * Existing values are never overwritten (e.g. a route that sets its own CSP).
 */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
