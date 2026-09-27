# VidoraTube — AI Architecture

Phase 0a audit, 2026-09-27. Evidence: `src/lib/providers/*`,
`src/lib/{image,video,voice,mode2,jobs,render}.server.ts`, `src/lib/api-cost.ts`,
`src/lib/credits.ts`, `api_usage` / `tts_cache` tables.

## 1. Provider abstraction (existing — keep it)

- Contracts: `src/lib/providers/contracts.ts` — interfaces for
  Metadata / Search / Voice / Video / Image / Stock / Publishing / Storage /
  Transcription providers.
- Registry: `src/lib/providers/registry.server.ts` — adapter catalog +
  health checks.
- Every provider call is expected to expose: model, task id, latency,
  estimated/actual cost, status, error, output, usage. Cost recording flows
  to the `api_usage` table via `src/lib/api-cost.ts` (`measured-cost.ts`).

This contract/registry pattern already satisfies the brief's "Provider
Abstraction" requirement structurally — extend it, don't replace it.

## 2. Provider inventory (verified, not assumed)

| Domain | Provider(s) | Entry point | Notes |
|---|---|---|---|
| LLM (plans, commentary) | Lovable AI gateway: `google/gemini-3.5-flash` | `jobs.server.ts` (cost-recorded to `api_usage`) | `mode2.server.ts` falls back to `OPENAI_API_KEY` for commentary |
| Image generation | Lovable AI gateway: `google/gemini-2.5-flash-image` | `src/lib/image.server.ts:27-29` (`LOVABLE_API_KEY`) | also used by `render.server.ts` |
| TTS (primary) | ElevenLabs | `src/lib/providers/voice.server.ts` (`xi-api-key`) | default voice "George" (`JBFqnCBsd6RMkjVDRZzb`), model `eleven_flash_v2_5`; `tts_cache` table caches outputs |
| TTS (fallback) | Lovable gateway: `openai/gpt-4o-mini-tts` | `render.server.ts` | — |
| Video generation | **fal.ai only** | `src/lib/video.server.ts` (`falProvider` is the sole entry in `VIDEO_PROVIDERS`) | single-provider dependency — no fallback |
| Stock media | Pexels + Pixabay | `src/lib/stock.server.ts` | licensed-source downloads; mock assets honestly labeled `mock://` |
| Transcription | contract only | `contracts.ts` | no transcription provider wired |
| Search / research | contract only | `contracts.ts` | no search provider wired |

No direct `openai` dependency in `package.json`. All provider secrets are
read from `process.env` server-side and throw when missing (e.g.
`render.server.ts:49`, `notifications.server.ts:105`); only
`VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` are client-bundled
(public by design).

## 3. Cost & usage tracking (existing — keep it)

- `api_usage` table records provider calls (model, latency, cost).
- `src/lib/api-cost.ts` + `measured-cost.ts` compute measured costs.
- **Credits are debited before expensive provider calls** via idempotent
  RPCs (`debit_credits_for_minutes` / `refund_credits_for_minutes` with the
  job id as ref — retries can't double-charge); refunds on failure
  (`src/lib/credits.ts`).
- External task IDs are persisted (render pipeline persists provider task
  state through `renders` / `workflow_jobs`), and billing webhooks are
  idempotent via `billing_events`.

## 4. Job durability for AI generations

- Render/video-job stages use atomic stage-claim transitions
  (`src/lib/jobs/stage-claim.ts`); stuck jobs reaped after 30 min.
- Worker retries while `attempts < max_attempts`; browser render persists
  segments to IndexedDB with 24h resume TTL.
- Paid-probe discipline: debits precede provider calls; no blind retries of
  paid jobs (retry path goes back through the claim/attempt counters).

## 5. Gaps for the roadmap

1. **Single video provider** — fal.ai is the only video-generation backend;
   an outage or price change has no fallback. Add a second provider behind
   the existing contract.
2. **No transcription provider** — captions/retention features that need
   transcripts have no wired backend.
3. **No search/research provider** — the brief's Trend Radar / Deep Research
   need one (or a licensed-data partner), plus source-evidence storage
   (`research_sources` / `research_claims` tables don't exist yet).
4. **No per-workspace / per-project budgets** — credits are per-user
   ledger-only; the brief's workspace budgets and provider-fallback policies
   are greenfield.
5. **No embedding pipeline** — pgvector + embedding jobs needed for the
   similarity features; nothing exists.
6. Vidora Agent (brief FEATURE 10) has no tool-calling harness yet — the
   server-function layer is the natural tool surface to expose to it.
