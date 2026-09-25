# VidoraTube P0 Audit — docs/AUDIT.md

> Date: 2026-09-25. Read-only static review of `Tyagi-99/vidoratube` @ main.
> Verdicts below are from code inspection, not runtime testing.

## 1. Inventory

- **Routes (21):** `/`, `/pricing`, `/auth`, `/reset-password`, `/features`, `/contact`, `/privacy`, `/terms`, `/studio` (auth-gated), `/projects`, `/projects/$projectId`, `/admin` + 5 sub-pages (users, content, jobs, integrations, plans, messages), `/api/public/youtube-callback` (OAuth callback).
- **Components:** 45 shadcn/ui primitives + 21 Vidora product components (AutoEditStudio, VoiceoverEditorPanel, RenderPanel, YouTubePanel, FinalVideoPreview, …).
- **Server:** No Supabase Edge Functions. TanStack Start (Nitro/h3, `src/server.ts`) via 9 `*.functions.ts` + `*.server.ts` pairs (admin, jobs, mode2, mode3, providers, public, renders, studio, youtube) + provider abstraction (`providers/http|image|video|voice|stock.server.ts`).
- **Tables (26, 16 migrations):** includes atomic credit ops (`debit_credits_for_job`, `refund_credits`, `adjust_credits`) and `content_rights_approved`.
- **RLS:** enabled on all 26 tables; owner-isolation policies + admin override via `has_role`. `api_usage` client INSERT revoked (server-write only). (Full per-table verification → §2.)
- **Storage:** single bucket `generated-videos`, private; RLS restricts to per-user folder + admin read-all.
- **Secrets:** server (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `LOVABLE_API_KEY`, `ELEVENLABS_API_KEY`, `GOOGLE_OAUTH_CLIENT_ID/SECRET`, `YOUTUBE_TOKEN_ENCRYPTION_KEY`); client (`VITE_SUPABASE_URL/KEY`). No hardcoded secrets; service-role only via `process.env` in server files.
- **Third-party:** Supabase, Lovable AI gateway (chat/image/speech), ElevenLabs TTS, YouTube/Google OAuth+Data API, Pexels, Pixabay, one OpenAI fallback (mode2), Google Fonts.
- **Tests:** 18 files, 124 tests, unit-only (FFmpeg compose, captions, job claims, credits, URLs). No E2E, no seeded test user.
- **Performance:** static output 1.6 MB; largest chunk `index` 560 KB; FFmpeg.wasm NOT bundled (CDN-loaded at render time); marketing pages have zero FFmpeg references. LCP risk is the 560 KB entry chunk — candidate for route-level code-splitting in P1.

## 2. Security review

_(pending — workstream running; will fill in per-table RLS proofs, client-bundle grep, host-guard allow-list check, server fallback check, bucket policies, token-encryption check)_

## 3. Billing integrity

| # | Finding | Severity | Location |
|---|---------|----------|----------|
| B1 | **Modes 2 & 3 never debit credits.** Voiceover/auto-edit flows log `api_usage` (ElevenLabs TTS + images) but charge 0 credits. Live provider-cost leak. | 🔴 Critical | `src/lib/mode2/mode2.server.ts:160` |
| B2 | **Flat 1 credit per video regardless of duration.** 10 free credits = ten long ElevenLabs-narrated videos. Unit-economics bomb. | 🔴 Critical | `src/lib/jobs.functions.ts:68` |
| B3 | **Free credits have zero abuse protection.** 10 credits granted by `handle_new_user` trigger with no email-verification gate, no disposable-email block, no IP/device limits. Rate limiter is in-memory and only wired to the contact form. | 🔴 Critical | `supabase/migrations/20260817072756_….sql:19`, `src/lib/rate-limit.ts` |
| B4 | Double-submit of `createVideoJob` creates 2 jobs and charges twice (no idempotency key). UX cost, no corruption. | 🟠 High | `src/lib/jobs.functions.ts` |
| B5 | Debit happens after LLM plan generation — a failed debit wastes one LLM call (pre-check mitigates common case). | 🟡 Medium | `src/lib/jobs.functions.ts:95-135` |
| B6 | `adjust_credits` records requested delta in ledger even when balance clamps at 0 → `SUM(ledger)` can drift from `profiles.credits` after negative admin adjustment. Audit-trail only. | 🟡 Medium | `20260925060000_atomic_credit_ledger.sql` |

**What's solid:** credits can't go negative (`credits >= 1` guard in `debit_credits_for_job`); concurrent debits serialize on the profile row lock (no double-spend); refunds idempotent per job; publish claim is atomic compare-and-set; all credit RPCs are `SECURITY DEFINER`, service_role-only; client-side credit tampering blocked by trigger RLS.

## 4. YouTube flow

| # | Finding | Severity | Location |
|---|---------|----------|----------|
| Y1 | `youtube.upload` + `youtube.readonly` requested **upfront at connect**, not incrementally at first publish. Hurts conversion + verification posture. | 🟠 High | `src/lib/youtube.server.ts:8-11` |
| Y2 | Revoked/expired token → plain toast; stale row not cleaned, panel can show "Connected" while publishes fail; **no reconnect CTA**. | 🟠 High | `src/lib/youtube.functions.ts`, `src/routes/_authenticated/studio.tsx:94-110` |
| Y3 | `selfDeclaredMadeForKids: false` **hardcoded** — no user choice (COPPA risk). | 🟠 High | publish metadata |
| Y4 | No scheduling, no caption upload, no thumbnail set, no quota tracking, no E2E test upload. | 🟠 High | — |

**What's solid:** PKCE S256 + HMAC-signed 15-min state; `refresh_token` required; tokens AES-256-GCM encrypted at rest, columns revoked from `authenticated` (service_role only); resumable chunked upload (8 MB, retry ×3, offset resync) streamed from private bucket via signed URL; owner-scoped RLS.

## 5. Performance

- Static 1.6 MB total; entry chunk 560 KB (code-split candidate).
- FFmpeg.wasm lazy/CDN — marketing pages clean.
- No LCP measurement in CI; add Lighthouse budget in P1.

## 6. Prioritized fix table

| Priority | Item | Phase |
|----------|------|-------|
| 🔴 Critical | Debit credits in Modes 2/3 (stop the cost leak) | P1 |
| 🔴 Critical | Free-credit abuse controls (verification gate, disposable-email/IP/device limits, real rate limits) | P1 |
| 🔴 Critical | Per-minute metering (replace flat 1-credit) | P7 (flags in P1) |
| 🔴 Critical | Security pass: per-table RLS proofs, bundle grep, host-guard + fallback re-check | P1 (§2 above) |
| 🟠 High | Incremental `youtube.upload` grant | P1/P5 |
| 🟠 High | Revoked-token reconnect CTA + row cleanup | P1 |
| 🟠 High | madeForKids user choice (remove hardcoded false) | P1 |
| 🟠 High | Idempotency key on `createVideoJob` | P1 |
| 🟠 High | Playwright E2E (signup → render → download) + mobile screenshots | P1 |
| 🟠 High | Sentry + PostHog + /status | P1 |
| 🟡 Medium | Debit before LLM plan generation | P1 |
| 🟡 Medium | `adjust_credits` ledger-drift fix | P1 |
| 🟡 Medium | Entry-chunk code-splitting | P1 |

**P0 acceptance:** this file exists; §2 security review completes; Critical items B1–B3 have P1 tickets (above). No behavior change shipped in P0.
