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

## Phase 3 — Creation, Stream B: research → script layer (F9/F11/F12) — 2026-09-28

Branch `phase3/stream-b` (base `cab2f1e`, coordinator-owned creation contracts — `src/lib/creation/contracts.ts` NOT edited). One migration, forward-only, `IF NOT EXISTS`:
`supabase/migrations/20260928041100_p3_stream_b.sql` — `research_sources.position`, `research_claims.review_state` (`unreviewed`|`confirmed`|`waived`) + `reviewed_by`/`reviewed_at`/`review_note`, `projects.research_strict_mode`. **Not applied to production** — Lovable requires manual apply in the SQL editor (KNOWN_ISSUES).

**F9 Visual Research** — `ResearchCanvas.tsx` + `src/lib/creation/research-canvas/`: per-project source list/add/edit/delete/exact-set reorder, type badges, Trend Radar citations, >6-month stale flags, claim counts. Explicit up/down controls (no fake drag-and-drop).

**F11 Deep Research hardening** — `EvidenceDesk.tsx` + `src/lib/creation/claims/`: deterministic sentence-level claim extraction (read-only — nothing saved/approved by extraction), keyword-overlap source linking, explicit confirm/waive, strict-mode toggle. Reusable `getProjectStrictGate` (`src/lib/creation/claims/strict-gate.ts`).

**F12 Script Studio** — `ScriptStudio.tsx` + `src/lib/creation/scripts/`: section editor, append-only versions, diff/restore, 150wpm ESTIMATE timing, brand-voice binding (vocabulary/tone/persona/do/don't serialized into the AI prompt), draft→in_review→approved→locked (server-enforced), preflight-gated AI draft (1 credit, debit-before-persist per D100, `ProviderResult` envelope, `actualCost: 1`).

**Enforcement (D105/D107/D108):** strict mode = every claim needs human CONFIRM (waived still blocks). Server-enforced: script approval, publish approval, publish execution (execution re-checks before the uploader runs — one shared `assertPublishStrictGate`). Client-enforced: package ZIP export button (disabled + re-check before packaging; publish upload stays server-gated).

**Project route** (`projects.$projectId.tsx`): ResearchCanvas + ScriptStudio + EvidenceDesk stacked after SafetyPanel; strict-gate banner; export disabled while blocked. The route owns the selected script ID and shares it between ScriptStudio (controlled picker) and EvidenceDesk (claim extractor reads the same script). Existing scenes/StudioV2/render/publish flows untouched.

**Tests (2026-09-28):** `src/lib/creation` **88/88** (canvas 20, scripts 33, claims 18, evidence 7, strict-gate 6, creation-modes 4) + `publish-strict-gate.test.ts` **7/7**. Full suite / build / ESLint / dev-server walkthrough still to run before merge.

## What's next

Phase 2 owner-only dependencies: `YOUTUBE_API_KEY` (no live configured-path verification possible without it), manual migration apply (2 new files, in order), `TEST_USER_EMAIL`/`TEST_USER_PASSWORD` for authenticated Playwright, then merge `phase2/intelligence` → `main`.

## Phase 3 — Creation, Stream A: Ideation & Packaging (F8 / F13 / F14 / F25): SHIPPED (code; migration apply pending)

Branch `phase3/stream-a` in worktree `~/workspace/vidoratube-s3a` (not pushed; never merge to main or rebase per assignment). Coordinator-owned `src/lib/creation/contracts.ts` untouched.

| Feature | Content |
|---|---|
| F8 Viral Idea Engine | `src/lib/creation/ideas/`: `scorer.ts` (deterministic 4-factor scoring: outlier_alignment 35 / hook_strength 25 / feasibility 20 / safety 20, pinned D99; evidence strings per factor; thin evidence → low confidence + `insufficient_data`; verdict explicitly not a virality prediction; keyword matching against Phase 2 outlier evidence), `ideas.functions.ts` (list/create/rescore server fns; `scoreIdeaFn`; score cache payload for `video_ideas.score`). Deduplication: idea→project reuses existing `useIdea` (real `projects` row, `video_ideas.project_ref` + status `used`); hub list fn named `listIdeasForHub` to avoid collision. 25 tests (17 scorer + 8 functions). |
| F13 Brand Voice | `src/lib/creation/brand/brand.functions.ts`: owner-scoped CRUD for `brand_profiles`, workspace association validated via `getWorkspaceRole`, vocabulary normalization; `resolveBrandProfileForUser` binding helper for Script Studio (explicit owned id wins; exactly one profile → auto-select; multiple + no explicit selection → null, no guessing). No LLM calls — profiles are data + binding. 13 tests. |
| F14 Title Lab | `src/lib/creation/titles/`: `titles.ts` (deterministic template variant generation, no paid LLM per D101; pinned `TitleScore` factors length/keyword/curiosity/clarity; `weakEvidence`, neutral keyword score without corpus; packaging heuristics, never CTR predictions), `titles.functions.ts` (persist to `title_variants`, status transitions draft/testing/winner/retired, one-winner invariant, experiment creation: draft row + even-split arms, variants → testing; Phase 4 runs/reads). 22 tests (12 + 10). |
| F25 Idea → Campaign | `src/lib/creation/campaigns/`: `campaigns.ts` (`buildCampaignPlan`, deterministic package builder: longform/shorts/thumbnail_set/titles/metadata items; artifacts start `planned` with `ref: null` per D102 — no fabricated references), `campaigns.functions.ts` (create/get/list/advance/link; status flow draft→in_production→ready enforced; `linkCampaignItem` attaches real artifact UUIDs later). 16 tests (12 + 4). |

**Migration (forward-only, `IF NOT EXISTS`, owner-scoped):** `supabase/migrations/20260928041000_p3_stream_a.sql` adds `video_ideas.score jsonb NOT NULL DEFAULT '{}'::jsonb` (score = recomputable cache, not source of truth). Existing `video_ideas` RLS covers it. NOT applied to production — manual apply via Lovable dashboard SQL editor (KNOWN_ISSUES).

**UI:** `/create` (idea list/create/score/factor expansion, idea→project handoff via `useIdea`, idea→campaign dialog), `/create/brand-voices`, `/create/titles` (project select, generate/score, status actions, experiment creation), `/create/campaigns` (list/detail, advance, link real artifact UUIDs); `Create` nav item in `AppChrome`. All surfaces carry loading/empty/error/disabled states.

**D89/D92 compliance:** all new local table declarations are `type` aliases; lint run only over touched files (0 errors after fix); `routeTree.gen.ts` regenerated by the dev server (was causing typed-route errors).

## Phase 3 Stream A final gate (2026-09-27)

- `npx tsc --noEmit` — clean (0 errors)
- `npx vitest run src/lib/creation` — **78/78 pass, 8 files** (incl. 4 pre-existing `creation-modes` tests)
- `npx eslint` on Stream-A paths — 0 errors, 0 warnings
- `npm run build` — PASS (Nitro deploy output generated)
- Dev-server route walkthrough — **4/4 new routes 200** (`/create`, `/create/brand-voices`, `/create/titles`, `/create/campaigns`), zero server exceptions
- Playwright E2E — not run by this agent (no live-browser access); delegated to parent/root for authenticated workflow verification
- VM rebooted mid-session (~20:11 UTC); all gates rerun after reboot

## What's next

Stream A owner-only dependency: apply `20260928041000_p3_stream_a.sql` via Lovable dashboard SQL editor (idempotent). Stream F integration entrypoints: `scoreIdea`/`scoreIdeaFn` (F8), `resolveBrandProfileForUser` (F13), `generateTitleVariants`/`scoreTitle`/`generateAndSaveTitleVariants` (F14), `buildCampaignPlan`/`createCampaignFromIdea`/`linkCampaignItem` (F25). No paid provider calls in Stream A — no credit preflight needed.
Phase 3 Stream B remaining gates: full `vitest` suite, scoped ESLint, `npm run build`, dev-server/curl walkthrough, then merge `phase3/stream-b`. Owner-only dependencies carry over: manual migration apply (now 3 new files incl. `20260928041100_p3_stream_b.sql`, in filename order), `LOVABLE_API_KEY` for the AI draft configured path (unconfigured envelope is unit-verified, zero network calls).
