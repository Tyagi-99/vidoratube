# Changelog

## 2026-09-25 — P1: Hardening (billing, abuse, security, YouTube UX, observability, E2E)

### Billing & abuse (Stream A)
- Fixed critical cost leak: Modes 2 (voiceover) and 3 (auto-edit) now debit credits
  before paid provider calls (ElevenLabs, image APIs).
- New-profile default credits changed from 10 to 0; 10 credits granted only after
  verified email/Google sign-in, once per profile.
- Added `disposable_email_domains` table with seed data; blocks disposable emails.
- Added `abuse_signals` table with IP/device abuse checks.
- PostgreSQL-backed rate limiting for paid endpoints (30/h on regenerateScene).
- Creation idempotency keys prevent double-submit double-charges.

### Security (Stream B)
- Renamed `src/lib/providers/registry.ts` → `registry.server.ts` to prevent
  accidental client bundling of API keys.
- Added CSP, HSTS, X-Frame-Options, Referrer-Policy, nosniff headers.
- RLS static audit tests + live-DB owner-isolation SQL tests.
- Zod validation guardrails on server inputs.
- Contact form spam protection tests.

### YouTube UX & observability (Stream C)
- Incremental YouTube OAuth (upload scope requested only when needed).
- Revoked-token detection with reconnect CTA.
- Required made-for-kids choice (no longer hardcoded false).
- Sentry error tracking (no-op without DSN).
- PostHog analytics with typed events (no-op without key).
- Public `/status` health page with dependency checks.
- Upload scope verified before claiming publish jobs.

### E2E testing
- Playwright suite: public pages, mobile (375px), authenticated studio flow.
- Test user seed script (`scripts/seed-test-user.ts`).

### Verification
- `npx tsc --noEmit`: clean
- Vitest: 171/171 tests passing (26 files, up from 124/18)
- Production build: clean

## 2026-09-25 — P0: Audit & production remediation
- Master plan and audit saved to `docs/MASTER_PLAN.md`, `docs/AUDIT.md`.
- FFmpeg.wasm vendoring, Supabase hardening, atomic credits, encrypted YouTube
  tokens, render resume/cancel, double-spend protection, strict TypeScript.
- Real render proof: 18s 1080p H.264 MP4 via FFmpeg.wasm (FFprobe verified).
