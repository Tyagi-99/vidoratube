# VidoraTube — API Architecture

Phase 0a audit, 2026-09-27. Evidence: `src/routes/api/**`, `src/lib/*.functions.ts`,
`src/lib/*.server.ts`, `src/lib/billing/*`.

## 1. API surface style

There are no REST controllers and no Supabase Edge Functions. The API surface is:

1. **TanStack Start file-based API routes** (`src/routes/api/**`, Nitro
   handlers) — only 5 routes, all public-by-necessity (OAuth callbacks,
   payment webhooks).
2. **Server functions** (`createServerFn` in `src/lib/*.functions.ts`,
   invoked via `useServerFn`) — the entire authenticated app API. Guarded by
   the `requireAppUser` middleware (`src/lib/server-auth.ts`), which rejects
   anonymous/guest JWTs fail-closed.

## 2. Public HTTP routes

| Route | File | Auth | Purpose |
|---|---|---|---|
| `/api/public/youtube-callback` | `src/routes/api/public/youtube-callback.ts` | signed `state` verified before code exchange (`:21`) | Google OAuth callback → YouTube channel connection (AES-256-GCM token encryption) |
| `/api/public/meta-callback` | `src/routes/api/public/meta-callback.ts` | signed `state` verified (`:39`) | Meta Facebook Login callback → test Page token storage |
| `/api/webhooks/dodo` | `src/routes/api/webhooks/dodo.ts` | `verifyDodoWebhookSignature` before processing (`:22-26`) | Dodo Payments events; dedupe via `claimBillingEvent` (`billing_events`) |
| `/api/webhooks/stripe` | `src/routes/api/webhooks/stripe.ts` | signature-verified | Stripe events; same idempotency pattern |
| `/api/webhooks/razorpay` | `src/routes/api/webhooks/razorpay.ts` | `verifyRazorpayWebhookSignature` (`:20-24`) | Razorpay events; dedupe key derived from payload (`${event}:${entityId}`, `:36-41`) — weaker than Dodo's `webhook-id`; forgery still impossible without the signing secret |

Webhook → domain flow: `webhooks.server.ts` `processDomainEvent` resolves
credits from the **in-code plan catalog** (`dodo.ts:66-72`), never from the
provider payload.

## 3. Server-function modules (authenticated app API)

Largest: `publish.functions.ts` (813), `admin.functions.ts` (808),
`research.functions.ts` (712), `jobs.functions.ts` (664). Every admin export
calls `assertAdmin` (`admin.server.ts`, `has_role` SECURITY DEFINER pinned to
`auth.uid()`).

Notable dead modules (zero consumers — see PRODUCT_AUDIT.md):
`src/lib/meta.functions.ts` (would expose Meta connect/publish),
`src/lib/providers.functions.ts` (`getProviderStatus`).

## 4. External integrations

| Integration | Direction | Where | Notes |
|---|---|---|---|
| YouTube Data API v3 + OAuth2 | in/out | `src/lib/youtube.server.ts` (667 lines) | scopes `youtube.readonly`, `youtube.upload`, `youtube.force-ssl`; token encryption AES-256-GCM; upload/publish pipeline |
| Meta Graph API v26 | out (unreachable) | `src/lib/meta-publish.server.ts` (584 lines) | IG container → poll → `media_publish`; fail-closed test-account gates; no UI consumer |
| ElevenLabs TTS | out | `src/lib/providers/voice.server.ts` | `xi-api-key`; default voice "George" (`JBFqnCBsd6RMkjVDRZzb`), `eleven_flash_v2_5` |
| Lovable AI gateway (Gemini/OpenAI) | out | `src/lib/image.server.ts:27-29`, `mode2.server.ts`, `jobs.server.ts`, `render.server.ts` | image `google/gemini-2.5-flash-image`; plan gen `google/gemini-3.5-flash` (cost-recorded); TTS fallback `openai/gpt-4o-mini-tts`; `LOVABLE_API_KEY` |
| fal.ai (video generation) | out | `src/lib/video.server.ts` | **sole** entry in `VIDEO_PROVIDERS` — no fallback |
| Pexels / Pixabay (stock) | in | `src/lib/stock.server.ts` | trusted-source downloads for the worker |
| Dodo / Stripe / Razorpay | in (webhooks) | `src/lib/billing/*`, `src/routes/api/webhooks/*` | signature-verified, idempotent |
| Sentry / PostHog | out | `src/lib/analytics.ts` | error + product telemetry |

## 5. Rate limiting & abuse

- `contactLimiter`: 5 contact submissions/hour (`src/lib/public.functions.ts:54`).
- `rate_limit_buckets` table for general bucketing.
- `abuse_signals` table for abuse telemetry.

## 6. SSRF posture

No server-side fetch of arbitrary user-supplied URLs. `probeStorageHead`
(`renders.functions.ts:95`) only fetches Supabase-signed storage URLs. URL
inputs are validated (`z.string().url()`) and stored, never fetched
server-side. Worker downloads come from trusted stock providers or user
uploads via signed URLs.

## 7. Gaps for the roadmap's API+MCP plans

- No public developer API, no API-key scopes, no MCP interface exist today —
  all greenfield (the brief's FEATURE 41).
- The authenticated surface is server functions, not REST: a public API will
  need an explicit REST/JSON layer with scoped keys, rate limits, and audit
  logging (`audit_logs` table does not exist yet — only `abuse_signals` and
  `workflow_job_events`).
- Webhook surface is payments-only; YouTube PubSubHubbub / push ingestion
  does not exist.
