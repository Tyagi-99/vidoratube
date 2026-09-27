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

## Phase 3 — Stream C (Thumbnails & Characters): SHIPPED (code; apply + keys pending)

Delivered 2026-09-28 on `phase3/stream-c` (never pushed/merged per program rules).

**F15 Thumbnail Studio.** `supabase/migrations/20260928041200_p3_stream_c.sql` (additive; `thumbnail_projects` already existed). Layered canvas model (`src/lib/creation/thumbnails/canvas.ts`): normalized 0–1 coordinates, 16:9 + 9:16, text/image layers, backgrounds, z-order, ≤24 layers, immutable ops, corrupt-canvas fallback. Project flow `draft → in_review → approved` (approved terminal). 1–8 AI variants via `generateImageWithTelemetry()` with credit preflight; missing key returns honest `image_provider_unconfigured` — no fake images. Variants persist to canonical `public.thumbnails`; private `generated-videos` bucket; signed preview URLs. Compare two variants, select winner (clears sibling selection), link winner to a Phase-4 experiment arm (`experiment_arms.thumbnail_id`) — linkage only, metrics live in Phase 4. UI: `ThumbnailStudio.tsx` extended with a "Layered editor" tab (`LayeredCanvasEditor.tsx` + `ThumbnailProjectEditor.tsx`); standalone `/thumbnails` route (project picker, curl-verified 200). 31 new tests.

**F16 Character System.** Same migration adds `characters` (with `style_notes` jsonb) and `scenes.metadata` jsonb, owner RLS. CRUD + validated reference upload (JPEG/PNG/WebP, ≤5 MB, owner-scoped `character-refs/<uid>/<cid>/` paths, private storage, signed previews). Scene binding via `scenes.metadata.character_id` (null unbind, metadata preserved, foreign scene/character rejected). Every reference surface carries: “Reference attached — visual consistency across scenes is not yet verified.” No consistency claim until a six-scene proof render passes (founder/Phase-4 work). UI: `CharacterManager.tsx` rewritten (CRUD, style notes, upload, project→scene bind picker, usage list); standalone `/characters` route (curl-verified 200, SSR title + meta confirmed); mounted in StudioV2Panel. 16 new tests.

**Gates (measured):** `npx tsc --noEmit` clean · `npx vitest run src/lib/creation` 51/51 (4 files; includes pre-existing `creation-modes` 4) · ESLint 0 errors on all touched files · `npm run build` green · dev-server curl `/thumbnails` + `/characters` → 200.

**Founder-only before prod:** apply migration `20260928041200_p3_stream_c.sql` via Lovable dashboard SQL editor (in filename order); `LOVABLE_API_KEY` for image generation; six-scene proof render for any character-consistency claim.


## Phase 3 Wave 1 integration (2026-09-28) — Streams A–E merged into `phase3/creation`

**Merge commits:** ed583d3 (A) → d63afd6 (B) → f313a05 (C) → 99c4359 (D) → 509aa54 (E), then 251b3c8 (integration repair). All merges `--no-ff`, docs conflicts resolved by keeping both sides; `src/routeTree.gen.ts` regenerated via dev server (never hand-merged).

**Decision renumbering:** every stream independently used D99+; renumbered into one sequence during integration — Stream A kept D99–D104, B → D105–D108, C → D109–D115, D → D116–D124, E → D125–D130. Cross-references in docs and Stream B/E code comments updated. Next free: D131.

**Integration repair (251b3c8):** fixed a `react-hooks/rules-of-hooks` violation in `projects.$projectId.tsx` (a `useState` sat below two early returns after Stream B's merge — moved above them); `eslint --fix` (prettier) over Phase 3 touched files only. 32 `no-explicit-any` errors remain on pre-Phase-3 legacy lines in `src/lib/publish.functions.ts` / `src/lib/publish-gate.test.ts` (2026-09-25 era) — documented in KNOWN_ISSUES, not bulk-fixed per D92.

**Integrated gates (measured 2026-09-28):** `npx tsc --noEmit` clean · `npx vitest run` **1411/1411 pass, 141 files** · `npm run test:worker` **87/87 pass** · `npx eslint` on all 106 Phase-3 touched files — 0 errors on Phase 3 code · `npm run build` PASS · dev-server curls: `/create`, `/create/brand-voices`, `/create/titles`, `/create/campaigns`, `/characters`, `/voices`, `/studio`, `/studio/$projectId` → 200; `/thumbnails` → 307 in-app `?projectId=` redirect (expected); zero server exceptions.

**Migrations now pending manual apply (filename order):** `20260928041000_p3_stream_a` (video_ideas.score) · `20260928041100_p3_stream_b` (research review columns) · `20260928041200_p3_stream_c` (characters, scenes.metadata) · `20260928041300_p3_stream_d` (voices index). Stream E added no migration.

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

## Phase 3 — Creation (branch `phase3/stream-d`; not pushed to origin)

### Stream D — Voice & Stock (F17/F18): SHIPPED (code; keys + migration apply pending)

**F17 Voice Studio** (`src/lib/creation/voice/`, `src/components/vidora/voice/VoiceStudio.tsx`, route `/voices`, linked from `/studio`):
- TTS fallback chain `chain.server.ts`: ordered ElevenLabs → OpenAI TTS (`gpt-4o-mini-tts`, `src/lib/providers/openai-tts.server.ts`) → Lovable AI gateway; one attempt per provider, no blind paid retries; `ProviderResult`-style envelopes, never throws.
- Voice library `library.server.ts` + server fns `voice.functions.ts`: built-in `language_voices` catalog (read-only) merged with user `voices` rows; CRUD; upload validation (MIME allowlist, 25 MB cap, magic-byte check) with server-side object re-validation; clone legal gate (unchecked-by-default checkbox, server-enforced).
- `runVoiceoverJob`: durable `generation_jobs` row (idempotency-key dedupe, claim race-guard, `JOB_IN_PROGRESS` pollable state), credit preflight BEFORE any provider call (INSUFFICIENT_CREDITS / BUDGET_EXCEEDED / UNKNOWN_COST returned as codes), debit via idempotent `debitMinutesForJob` (estimate → whole minutes, 1 credit = 1 minute), MP3 → `generated-videos/{userId}/voiceovers/{jobId}.mp3` + 7-day signed URL, provider task records actual once (no double-count: `completeGenerationJob` gets no `costActualCredits`), checkpoint written BEFORE completion (saveCheckpoint refuses terminal rows), `failGenerationJob` refunds.
- D89: `voices` absent from generated DB types → local `VoiceRow`/`VoiceInsert`/`VoiceUpdate` aliases + `asVoicesClient` structural cast (established `asJobsClient` pattern); `language_voices` queried with its real columns (no `voice_type` there — catalog entries are always builtins).

**F18 Stock Media** (`src/lib/creation/stock/`, `src/components/vidora/stock/StockPicker.tsx`):
- `search.server.ts`: honest unconfigured envelope (`stockProviderStatus` key presence, no secret leakage) with ZERO network calls when no Pexels/Pixabay keys; explicit `includeMock` opt-in only — no silent mock substitution.
- `selectStockAsset`: writes `asset_provenance` (per-scene licensed-use log, D48/D49), `content_assets` row with rights in `technical_metadata.rights`, and `scenes.asset_url` + `scenes.asset_source = { kind: 'stock', provider, rights }` (coordinator contract shape).
- D48 preserved: mocks stay `mock://` + `"MOCK — preview asset, not licensed for use"`, never recorded as licensed.
- Wired into the established scene editor: `SceneCard` in `projects.$projectId.tsx` gains a "Stock" button (next to "Visual" regenerate) opening `StockPicker` for that scene, pre-filled with the scene's stock search terms; selection refreshes the project query. Not a standalone orphan.

**Migration (1, forward-only, `IF NOT EXISTS`):** `20260928041300_p3_stream_d.sql` — `voices(user_id, updated_at)` index (the Phase-1 table had no user-scoped index). Not applied to production (Lovable manual apply — KNOWN_ISSUES).

**Gates:** `npx tsc --noEmit` — clean on all Stream-D files (3 pre-existing errors in untouched `guides.$slug.tsx`); `npx vitest run src/lib/creation` — **58/58 pass, 5 files** (chain 11, library 12, voice.functions orchestration 8, stock 27); `npx eslint` on Stream-D paths — **0 errors, 0 warnings** (pre-existing notes in untouched legacy lines of `studio.tsx` and coordinator-owned `contracts.ts`); `npm run build` — PASS (`voices-Br1LJuTN.js` chunk bundled); dev-server curl — `/voices` + `/studio` 200, zero server exceptions.

**Founder blockers:** Pexels/Pixabay API keys (no live stock search verification possible), ElevenLabs/OpenAI keys (no live TTS verification), manual migration apply.

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

## Phase 3 — Stream F (F23 30-sec Quick Create, F26 SEO & Metadata Studio)

Branch: `phase3/stream-f` (not pushed). Coordinator-owned `src/lib/creation/contracts.ts` untouched.

| Workstream | State | Evidence |
|---|---|---|
| F23 quick-create pipeline lib | **SHIPPED** (code) | `src/lib/creation/quick-create/`: `pipeline.ts` (11 stages, honest paid-stage resolver, ESTIMATE cost math), `script.ts` (deterministic 25–35s script @150 WPM), `scenes.ts` (5–7 scenes → Stream E `buildSceneManifest`), `captions.ts` (phrase cues, `timing: "estimate"`), `quick-create.functions.ts` (run orchestration, F8/F11/Stream E reuse, real provider calls attempted only after approval+config). |
| F23 route `/create/quick-create` | **SHIPPED** (code) | One-screen flow: topic/hook/facts form (≥2 source URLs enforced), per-stage Run buttons, spend-approval checkbox, "Enqueue real render" button → existing `enqueueServerRender` (D132). Dev-server curl: HTTP 200 (matches existing authenticated-route behavior). Nav links added on creation hub. |
| F26 SEO lib + route `/create/seo-studio` | **SHIPPED** (code) | `src/lib/creation/seo/`: reuses Title Lab engine (D133), templates for description/hashtags, exactly 3 thumbnail concepts (no CTR claims); `seo.functions.ts` persists `seo_packages`, export runs real `getProjectStrictGate` with blocked envelope. Dev-server curl: HTTP 200. |
| `E2E_30_SECOND_CREATION` | **SHIPPED** (code) | `src/lib/creation/quick-create/e2e-30-second.test.ts` — 11 tests: F8 scoring, F11 claim→source linking (3 exact URLs), 25–35s script, 5–7 scenes → pinned manifest, scene regen, honest paid skips + ESTIMATEs, Stream E QC fail/pass, ESTIMATE captions, SEO package, never-publishes invariant. |
| Migration | **PENDING MANUAL APPLY** | `supabase/migrations/20260928041400_p3_stream_f.sql` — `quick_create_runs`, `seo_packages` (owner RLS, forward-only). Lovable does not auto-apply; apply via Cloud SQL editor in filename order. |

## Phase 3 Stream F final gate (2026-09-28)

- `npx tsc --noEmit` — clean (0 errors)
- `npx vitest run` (full app suite) — **1447/1447 pass, 147 files** (48 new Stream F tests; RLS audit updated for the 2 new tables)
- `npm run test:worker` — **87/87 pass** (worker untouched by Stream F)
- eslint on Stream F touched files — 0 errors (prettier --fix applied)
- `npm run build` — PASS
- Dev-server curl of `/create/quick-create` and `/create/seo-studio` — HTTP 200 both
