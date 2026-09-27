# Vidora OS — Implementation Status

Living document, updated from verified state only. Branch: `phase2/intelligence`
(not pushed to origin; parent merges to main after verification).

## Phase 1 — Foundation

| Workstream | State | Evidence |
|---|---|---|
| 1. Workspace roles & audit | **SHIPPED** (code) | `src/lib/workspace-auth.server.ts` (6-role matrix, `requireWorkspaceRole` middleware), `src/lib/audit-log.server.ts` (`writeAuditLog`/`auditSafely`), `src/lib/admin-access.ts` (403 state), admin 403 panel replaces client redirect (S2). 34 new tests. Migration `20260928020600_p1_workspace_roles.sql` widens role CHECK + backfills viewer→client + widens `is_workspace_editor`. |
| 2. Database | **SHIPPED** (code; apply pending) | 7 migration files `20260928020000`–`20260928020600`: 32 new tables, pgvector + `vector(768)` embeddings, pg_cron schedule for `requeue_stale_renders`, RLS on all new tables, `rls-policies.test.ts` extended. NOT applied to production (manual step — KNOWN_ISSUES). |
| 3. Jobs durability | **SHIPPED** (code; deploy pending) | `src/lib/jobs/durable-jobs.server.ts`: race-safe state machine (queued→running→checkpointed→queued→completed/failed, max-attempts guard, terminal completed), idempotency-key dedupe (23505 race handling, cross-user conflict throws), `provider_tasks` upsert (UPDATE-then-INSERT), cost estimate vs actual + `getJobCostSummary`, refund-on-fail via existing RPC (never mints). Wired into `enqueueServerRender` (post-insert, try/catch, never breaks enqueue). 24 new tests. Worker deployment remains founder-blocked (KNOWN_ISSUES #1). |

## Phase 1 final gate (2026-09-27)

- `npx tsc --noEmit` — clean
- `npx vitest run` — **976/976 pass, 108 files**
- `npm run test:worker` — **76/76 pass**
- `npm run lint` — 0 errors on all Phase-1-touched files; repo baseline (4459 errors / 13 warnings on `origin/main`) untouched per D92
- `npm run build` — production build passes
- E2E browser suite — not run by this agent (no live-browser access); delegated to parent/root for authenticated workflow verification.
| 4. Credits | **SHIPPED** (code) | `src/lib/credits/`: `estimates.server.ts` (ESTIMATE-labeled, pinned Studio-plan $0.245/credit reference, unknown prices → null not invented), `balance.server.ts`, `budgets.server.ts` (caps enforced against `generation_jobs.cost_actual_credits` month-to-date; null = uncapped), `usage.server.ts` (read-model over `credit_ledger`), `preflight.server.ts` (estimate→balance→budget). TTS voiceover stage gated: INSUFFICIENT_CREDITS/BUDGET_EXCEEDED instead of provider call. 46 new tests. |
| 5. Providers | **SHIPPED** (code) | `ProviderResult` envelope (model/taskId/latency/cost/status/error/usage, never throws), `withProviderTelemetry` wired into TTS + image paths → `api_usage`. Real: ElevenLabs Scribe transcription, YouTube Data API search. Honestly-unconfigured: web search shell (needs key), video gen without `FAL_API_KEY`. `generateVideoWithFallback`: ordered chain, one attempt per provider, no blind paid retries (fakes only in tests). 20 new tests. |

## Reconciliation decisions (DB)

- Extended, not duplicated: `video_ideas` (= plan's `ideas`), `learning_insights` (= plan's `learnings`).
- Documented-as-canonical via `COMMENT ON TABLE`: `publish_jobs` (= `publishing_jobs`), `thumbnails` (= `thumbnail_variants`), `content_assets` (= `assets`).
- Created: `channels`, `channel_snapshots`, `competitor_channels`, `videos`, `video_snapshots`, `research_sources`, `research_claims`, `folders`, `folder_rules`, `folder_items`, `scripts`, `script_versions`, `brand_profiles`, `voices`, `scene_versions`, `thumbnail_projects`, `title_variants`, `content_packages`, `generation_jobs`, `provider_tasks`, `experiments`, `experiment_arms`, `channel_connections`, `analytics_snapshots`, `retention_snapshots`, `comments`, `engagement_insights`, `audit_logs`, `workspace_budgets`, `project_budgets`, `api_keys`, `niche_snapshots`.
- `publish.approve` deliberately absent from the workspace permission matrix — the server-enforced `approvals` gate (D61/D62) is not weakened.

## Phase 2 — Intelligence (F1–F7): SHIPPED (code; apply + keys pending)

Four streams merged on `phase2/intelligence` (base `main@9014061`; not pushed):

| Stream | Content | Merge |
|---|---|---|
| A | YouTube ingestion backend: `channels.list`/`videos.list`/`search.list`, `youtube_api_cache` (channel 24h / video 6h / search 1h TTL), quota recording, honest `unconfigured` without `YOUTUBE_API_KEY`, snapshot writers, subscriber-growth, track/untrack/list/detail/refresh/search channels, list/detail/refresh/compare-3 videos, real `video_ideas` handoff into an "Outlier drafts" project | `a0ffc10` |
| B | F1/F2/F6: deterministic explainable Niche Finder scoring (demand labeled **ESTIMATE**, competition/velocity/freshness, confidence degradation), `niche_snapshots` persistence, deterministic Channel Blueprints in `niches.blueprint`, Trend Radar from snapshot velocity with `research_sources` citations | `920dc7d` |
| C | F3/F4/F5: channel search/tracking/sorting/filtering + detail + sparkline + ESTIMATE-labeled similar channels, outlier score = latest views ÷ sibling median, video packaging/publishing/performance facts, 3-video comparison, `aiNotes: []` (no LLM wired) | `980ea0e` |
| D | F7: Smart Folder CRUD/rules/pins/server-side matching (500-row scan limit), `/intelligence` hub + `/intelligence/folders`, app navigation, permanent `e2e/niche-finder.spec.ts` | `90418dc` |

Shared contracts pinned at `9960abc` (coordinator-owned intelligence types; no fake data anywhere).

**Integration fixes (this continuation):** 15 TS errors from A/C signature mismatches fixed; honest envelope unions added; `ChannelSnapshot` re-exported; `VideoDetail` expanded; `capturedAt`/`captured_at` mismatch fixed; 17 new `any` lint errors typed; Smart Folders use structural `AdminDb` (generated types lack intelligence tables); `ui-states.tsx` component-only (React Refresh clean). E2E/UI alignment fixed 2026-09-27: niche create-dialog flow (`htmlFor`/`id` label associations on dialog + filter bar), `data-testid` row hooks (`channel-row`, `video-row`, `outlier-row`, `trend-row`), spec rewritten to real flow (New niche → fill → Create niche → score/factors/filters → blueprint → channel detail → video intel → outliers + draft-script handoff → trends → folders).

**Routes (all 200, no SSR exceptions, dev-server walkthrough 2026-09-27):**
`/intelligence`, `/intelligence/niches`, `/intelligence/niches/$nicheId`,
`/intelligence/channels`, `/intelligence/channels/$channelId`,
`/intelligence/outliers`, `/intelligence/videos/$videoId`,
`/intelligence/trends`, `/intelligence/folders`.

**Migrations (2 new, forward-only, non-destructive, `IF NOT EXISTS` only):**
`20260928030000_p2_channel_niche.sql` (`channels.niche_id` + index),
`20260928030100_p2_blueprint.sql` (`niches.blueprint` + filter columns).
Not applied to production (Lovable requires manual apply — KNOWN_ISSUES).

## Phase 2 final gate (2026-09-27, rerun after integration + E2E alignment)

- `npx tsc --noEmit` — clean (0 errors)
- `npx vitest run src/lib/intelligence` — **129/129 pass, 8 files** (A37 + B35 + C37 + D20)
- `npx vitest run` — **1105/1105 pass, 116 files**
- `npm run test:worker` — **76/76 pass** (unchanged)
- `npx eslint` on Phase-2 paths — **0 errors, 0 warnings**; repo-wide baseline: 4355 problems (4342 errors / 13 warnings) vs 4366 (4353 / 13) on base `9014061` — Phase 2 adds zero new errors
- `npm run build` — PASS (Nitro deploy output generated)
- Dev-server route walkthrough — 9/9 routes 200, zero server exceptions
- Playwright E2E — see TEST_RESULTS.md

## What's next

Phase 2 owner-only dependencies: `YOUTUBE_API_KEY` (no live configured-path verification possible without it), manual migration apply (2 new files, in order), `TEST_USER_EMAIL`/`TEST_USER_PASSWORD` for authenticated Playwright, then merge `phase2/intelligence` → `main`.

## Phase 3 — Stream E (F20 Video Studio, F21 Render Checkpoints, F24 Shorts Repurposing)

Branch: `phase3/stream-e` (not pushed). Coordinator-owned `src/lib/creation/contracts.ts` untouched.

| Workstream | State | Evidence |
|---|---|---|
| Explicit audio root fix (D99) | **SHIPPED** (code) | `buildFinalAudioMix` (`src/lib/audio.ts:117`) — explicit `[voice]asplit=2[vkey][vmix]` topology (sidechain key vs audible mix); worker dependency-free mirror (`worker/src/pipeline.ts:442-444`). Old graph's double consumption was correct-by-design (control signal), now explicit + unit-testable. |
| F20 Video Studio backend | **SHIPPED** (code) | `src/lib/creation/video-studio/`: `manifest.ts` (pinned `SceneManifest` via `buildSceneManifest`/`manifestFromStudioScenes`; duration explicitly an estimate until measured audio), `regen.server.ts` (`regenerateSceneAudioCore`/`regenerateSceneVisualCore`/`recomputeSceneTimingCore` — owner verify, preflight, one provider attempt, debit-before-provider, refund-on-fail, `scene_versions` row; TTS invoked `{voiceId, model}`), `qc.ts` (`qcStudioTimeline` → pinned `QCResult`), `studio.functions.ts` (JSON-safe server fns). |
| F20 Video Studio route | **SHIPPED** (code) | `src/routes/_authenticated/studio.$projectId.tsx` — Scenes / Assemble & Render / Shorts tabs; scene edit + per-scene regen + repair; QC blocking gates; quote via existing quoting; enqueue via existing `enqueueServerRender`; durations labeled ESTIMATE. Dev-server curl: HTTP 200. |
| F21 checkpoint foundation | **SHIPPED** (code) | App: `src/lib/creation/checkpoints/checkpoints.ts` — `generation_jobs.checkpoint.studio` (done/failed/first-incomplete/invalidate-one-scene). Worker: `worker/src/segment-checkpoints.ts` + `readRenderCheckpoint`/`markSegmentDone` (`worker/src/supabase.ts`) — `renders.checkpoint.segments`, resume from first incomplete, stale-local-segment cleanup. D100: two stores intentionally separate, not auto-synced. |
| F24 Shorts repurposing | **SHIPPED** (code) | `src/lib/creation/shorts/`: rule-based hook-first recut plan (labeled not-AI), tightened narration, 9:16, duration cap, exact quote; enqueue `kind: "short"`; `parent_id` = optional source RENDER id (D102 — self-FK to `renders(id)`, never the project id; project link via `project_id`); never auto-publishes. |
| RenderPanel extension | **SHIPPED** (code) | Optional `renderKind`/`parentRenderId` props (defaults = existing full-render behavior); single `enqueueServerRender` path unchanged (D104). |

No migration needed: all Stream E state uses existing tables/columns (`scenes`, `scene_versions`, `generation_jobs.checkpoint`, `renders.checkpoint`, `renders.parent_id` + self-FK from `20260926001000_renders_parent_id.sql`, `renders.meta`).

## Phase 3 Stream E final gate (2026-09-28)

- `npx tsc --noEmit` — clean (0 errors)
- `npx vitest run` (full app suite) — **1145/1145 pass, 121 files**
- `npx vitest run src/lib/creation` — **39/39 pass, 6 files**
- `npx vitest run src/lib/audio.test.ts` — **11/11 pass**
- `npm run test:worker` — **87/87 pass, 28 suites** (10 new segment-checkpoint tests + explicit-asplit dry-run)
- eslint on Stream E touched files — 0 errors in Stream E-introduced lines; pre-existing violations in untouched legacy lines left alone per D92 (coordinator-owned `contracts.ts` not edited)
- `npm run build` — PASS
- Dev-server curl of `/_authenticated/studio/$projectId` — HTTP 200
