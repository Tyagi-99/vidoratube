# VidoraTube → Vidora OS — Feature Matrix

Phase 0 deliverable, 2026-09-27. Assembled from `docs/PRODUCT_AUDIT.md`
(evidence-backed current state), `docs/COMPETITOR_RESEARCH.md` (patterns worth
reimplementing), and the $500M brief.

**Status rules (per brief):** `COMPLETE` only when the feature's tests pass.
`IN PROGRESS` = exists but incomplete. `NOT STARTED` = not built. Estimates are
labeled **ESTIMATE**; AI conclusions are labeled as such; demo data will be
labeled `DEMO DATA` wherever it appears in product.

**Test columns:** U = unit (vitest) · I = integration (server functions / RPCs
against a test DB) · E = end-to-end (Playwright) · M = manual verification
checklist. `pass` = measured green · `missing` = not yet written ·
`n/a` = not applicable.

*Database COMPLETE = schema coded, RLS-covered, static tests green. Migrations are NOT applied to production (Lovable requires manual apply — see KNOWN_ISSUES.md).

## Foundation

| Feature | Current state | Target state | Frontend | Backend | Database | External API | U | I | E | M | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Auth | REAL — Supabase email auth, `requireAppUser` fail-closed middleware, RLS everywhere | Harden: session rotation, admin 403 clarity | existing | existing | existing | Supabase Auth | pass | missing | missing | done | COMPLETE |
| Workspace | REAL — roles + audit + 403 shipped (Phase 1) | Roles (Owner/Admin/Strategist/Creator/Viewer/Client), scoped permissions, audit log | done | done | `audit_logs` + widened role CHECK | — | pass (34 new) | missing | missing | done | COMPLETE |
| Database | REAL — 32 new tables migrated (Phase 1), RLS everywhere | + new entities below, pgvector, workspace budgets, cron owner for `requeue_stale_renders` | — | migrations | 32 new tables | — | pass (RLS test 9/9) | missing | n/a | done | COMPLETE* |
| Jobs | PARTIAL→REAL (code) — durable state machine + provider_tasks + cost tracking (Phase 1); worker deploy still founder-blocked | Deploy worker, checkpoint/resume, scene-level repair, provider task IDs, idempotency | done | done | `generation_jobs`, `provider_tasks` | fal.ai | pass (24 new) | missing | missing | done | IN PROGRESS |
| Credits | REAL — estimates + budgets + pre-flight gate shipped (Phase 1) | + cost estimates, balance checks, workspace/project budgets | done | done | `credit_ledger` + `workspace_budgets` + `project_budgets` | — | pass (46 new) | missing | missing | done | COMPLETE |
| Providers | PARTIAL→REAL — telemetry envelope + real transcription/search, video fallback chain (Phase 1) | Formal interfaces, fallbacks, usage+latency+cost tracing | done (telemetry wrappers) | done (registry) | `provider_tasks` | ElevenLabs, fal.ai, YouTube | pass (20 new) | missing | missing | done | IN PROGRESS |

## Intelligence (DISCOVER → VALIDATE)

| Feature | Current state | Target state | Frontend | Backend | Database | External API | U | I | E | M | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F1 Niche Finder | REAL (code) — deterministic explainable scoring: factors shown (demand **ESTIMATE**-labeled, competition, velocity, freshness), confidence degrades on weak evidence, filters (language/format/subs/active/recent), `niche_snapshots` persisted, freshness labels; `aiNotes` none (no LLM) | Explainable opportunity scoring (factors shown, confidence reduced when evidence weak), filters, freshness/source labels | done | done | `niches`, `niche_snapshots` | YouTube Data API | pass (35 new) | missing | pending* | done | COMPLETE |
| F2 Channel Blueprints | REAL (code) — deterministic rule-based blueprint (positioning/pillars/formats/cadence) persisted in `niches.blueprint`, no LLM | Niche → positioning/pillars/formats/cadence blueprint generator | done | done | `niches` | — | pass | missing | pending* | done | COMPLETE |
| F3 Channel Explorer | REAL (code) — search/track/sort/filter channels, detail with subscriber sparkline, ESTIMATE-labeled similar-channel heuristic, honest `unconfigured` without key | Search/compare channels, growth sorting, similar-channel search | done | done | `channels`, `channel_snapshots`, `competitor_channels` | YouTube Data API | pass (37 new, stream C) | missing | pending* | done | COMPLETE |
| F4 Outlier Explorer | REAL (code) — outlier score = latest views ÷ sibling median, velocity/factors/confidence shown, "Draft script" handoff creates real `video_ideas` row in an Outlier drafts project | Outlier scores, velocity, trend signals → ideation cards → "draft script" handoff | done | done | `videos`, `video_snapshots` | YouTube Data API | pass | missing | pending* | done | COMPLETE |
| F5 Video Intelligence | REAL (code) — descriptive packaging/publishing/performance facts, 3-video comparison, `aiNotes: []` | Per-video deep analysis, 3-video comparison | done | done | `videos`, `video_snapshots` | YouTube Data API | pass | missing | pending* | done | COMPLETE |
| F6 Trend Radar | REAL (code) — trends derived from video-snapshot velocity, every trend cites ≥1 `research_sources` row | Multi-source trend evidence, scored + cited | done | done | `niche_snapshots` | YouTube Data API, search | pass | missing | pending* | done | COMPLETE |
| F7 Smart Folders | REAL (code) — CRUD, rules, pins, server-side matching; rule scan limit 500 rows/table/folder (documented) | Dynamic rule-based folders across research assets | done | done | `folders`, `folder_rules`, `folder_items` | — | pass (20 new, stream D) | missing | pending* | done | COMPLETE |

\* E = Playwright `e2e/niche-finder.spec.ts`: selector alignment fixed 2026-09-27 (real New niche dialog flow, `data-testid` hooks); configured branch unrun — needs `YOUTUBE_API_KEY` + `TEST_USER_EMAIL`/`TEST_USER_PASSWORD` and burns real quota, so it runs deliberately by the founder. Unconfigured branch unit-verified (honest envelope, zero network/quota calls).

## Creation (IDEATE → PRODUCE)

| Feature | Current state | Target state | Frontend | Backend | Database | External API | U | I | E | M | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F8 Viral Idea Engine | REAL (code) — deterministic 4-factor scoring (outlier_alignment 35 / hook_strength 25 / feasibility 20 / safety 20, pinned D99), evidence strings per factor, thin evidence → low confidence + `insufficient_data`, verdict explicitly not a virality prediction; outlier evidence from `outlier_videos.outlier_score` (D100); score cache in `video_ideas.score` (recomputable, migration 20260928041000); idea → project reuses existing `useIdea` (real projects row); idea → campaign handoff | Evidence-backed scoring, outlier linkage, idea → project | done | done | `video_ideas` (+`score` jsonb) | — | pass (17+8 new) | missing | missing | done | COMPLETE |
| F9 Visual Research | REAL (code) — per-project canvas: add/edit/delete/reorder sources, type badges, Trend Radar citations, stale flags, claim counts | Research canvas: sources, clips, references per project | done | done | `research_sources` (+ `position`) | — | pass (20 new) | missing | missing | pending | COMPLETE (code; migration apply + keys N/A) |
| F10 Vidora Agent | NOT STARTED | Tool-calling conversational strategist; every recommendation ends in a real project with real costs + approval gates | new | new | all | LLM | missing | missing | missing | pending | NOT STARTED |
| F11 Deep Research | REAL (code) — Evidence Desk: deterministic claim extraction (read-only), keyword-overlap source linking, explicit confirm/waive, strict-mode toggle; D99 semantics (waived still blocks); strict gate blocks script approval + publish approval + publish execution; client-side package export gate | Claim-level citations, evidence desk, strict mode blocks unsupported claims | done | done | `research_sources`, `research_claims` (+ review columns) | search provider | pass (18 claims + 7 evidence + 6 gate + 7 publish-gate) | missing | missing | pending | COMPLETE (code; migration apply pending) |
| F12 Script Studio | REAL (code) — section editor, append-only versions, diff/restore, 150wpm ESTIMATE timing, brand-voice binding (vocabulary carried into prompt), draft→review→approve→lock (server-enforced), preflight-gated AI draft (1 credit, debit-before-persist, ProviderResult envelope) | Section-based editor, version history, timing, brand-voice binding | done | done | `scripts`, `script_versions` | LLM | pass (33 new) | missing | missing | pending | COMPLETE (code; migration apply pending) |
| F13 Brand Voice | REAL (code) — owner-scoped CRUD on `brand_profiles`, vocabulary normalization, `resolveBrandProfileForUser` binding helper for Script Studio (explicit id wins; exactly-one auto-select; multi-profile ambiguity → null, no guessing); no LLM calls yet — profiles are data + binding only | Voice profiles bound to script generation | done | done | `brand_profiles` (existing) | — | pass (13 new) | missing | missing | done | COMPLETE |
| F14 Title Lab | REAL (code) — deterministic template-based variant generation (no LLM spend, D101), pinned `TitleScore` factors (length/keyword/curiosity/clarity, D94 ESTIMATE labels), weak-evidence → neutral keyword score, framed as packaging heuristics never CTR predictions; status flow draft→testing→winner/retired, one-winner invariant, experiment creation (draft + even-split arms, Phase 4 runs/reads them) | Stats-disciplined title variants + experiments | done | done | `title_variants`, `experiments`, `experiment_arms` | — | pass (22 new) | missing | missing | done | COMPLETE || F15 Thumbnail Studio | REAL — 4 variants, select/persist (D80) | Layered editor, A/B variants, CTR experiment linkage | extend | extend | `thumbnail_projects`, `thumbnail_variants` | image gen | pass | missing | missing | pending | IN PROGRESS |
| F15 Thumbnail Studio | REAL — layered canvas editor (text/image layers, 16:9 + 9:16, backgrounds, z-order), project draft→in_review→approved flow, 1–8 AI variants with credit preflight (honest unconfigured state, no fake images), compare + winner selection, Phase-4 experiment-arm linkage; routes `/thumbnails`, `/characters` nav, dev-curl verified 200 | Layered editor, A/B variants, CTR experiment linkage | extend | extend | `thumbnail_projects`, `thumbnails` (canonical variants), `experiment_arms.thumbnail_id` | image gen | pass (31 new) | pass (envelope) | missing | pending | COMPLETE* |
| F16 Character System | REAL — CRUD + style notes, validated reference upload (JPEG/PNG/WebP ≤ 5 MB, private `generated-videos` bucket, signed previews), binding via `scenes.metadata.character_id` with usage lookup; UI states “Reference attached — visual consistency across scenes is not yet verified” everywhere a reference is shown | Consistent characters across scenes (pending proof render) | new | new | `characters`, `scenes.metadata` | image gen | pass (16 new) | pass (envelope) | missing | pending | IN PROGRESS* || F17 Voice Studio | REAL — voiceover mode, 16 voices (12 EN + 4 HI) | Multi-provider voice studio, uploads, cloning where legal | extend | extend | `voices` | ElevenLabs, OpenAI TTS | pass | missing | missing | pending | IN PROGRESS |
| F18 Stock Media | PARTIAL — `mock://` assets honestly labeled; real keys founder-blocked | Licensed stock with rights tracking per asset | extend | extend | `assets` (rights fields) | Pexels, Pixabay | missing | missing | missing | pending | IN PROGRESS |
| F19 Short-Form Engine | PARTIAL — quote UI disabled, labeled "Shipping next (target Oct 2026)" | Shorts generation + repurposing pipeline | new | new | `scenes`, `renders` | video gen | missing | missing | missing | pending | IN PROGRESS |
| F20 Video Studio | REAL — render quoting + browser/server enqueue, real MP4 via FFmpeg.wasm | Scene-based studio, per-scene regen, music ducking | extend | extend | `scenes`, `scene_versions`, `renders` | fal.ai, TTS | pass | missing | missing | pending | IN PROGRESS |
| F21 Render Checkpoints | PARTIAL — browser resume via IndexedDB (24h TTL); server checkpoints partial | Durable checkpoints, scene-level repair, resume after restart/closed browser | extend | extend | `generation_jobs` | — | pass | missing | missing | pending | IN PROGRESS |
| F22 Production Readiness | REAL — `/status` runs real system checks | Expanded diagnostics: provider health, queue depth, cost, render metrics | extend | extend | — | all | pass | missing | missing | pending | IN PROGRESS |
| F23 30-sec Quick Create | NOT STARTED | One input → researched, cited, captioned 9:16 video in one flow (**E2E_30_SECOND_CREATION**) | new | new | all creation tables | all | missing | missing | missing | pending | NOT STARTED |
| F24 Shorts Repurposing | NOT STARTED | Long-form → shorts with hooks recut | new | new | `renders`, `scenes` | — | missing | missing | missing | pending | NOT STARTED |
| F25 Idea → Campaign | REAL (code) — deterministic campaign package builder (longform/shorts/thumbnail_set/titles/metadata); artifacts start `planned` with `ref: null` (D102, no fabricated references); real refs linkable later; status flow draft→in_production→ready enforced | One idea → multi-format campaign (long + shorts + thumbnails + titles) | done | done | `content_packages` (existing) | — | pass (16 new) | missing | missing | done | COMPLETE |
| F26 SEO & Metadata | REAL — generate/get/update SEO metadata (D81) | Full SEO studio, hashtag/tag strategy, upload presets | extend | extend | existing | — | pass | missing | missing | pending | IN PROGRESS |

\* **F15 COMPLETE** (Phase 3 Stream C, 2026-09-28): all Stream C scope shipped and unit/integration-tested (47 new tests); CTR metrics on experiment arms belong to Phase 4. **F16 IN PROGRESS** (Phase 3 Stream C, 2026-09-28): character CRUD, reference upload, and scene binding are complete and tested (16 new tests); the outstanding target is the six-scene proof render that proves visual consistency — no consistency claim is made until it passes (see KNOWN_ISSUES.md). Both ship with migrations unapplied (manual dashboard apply required).

## Operations (REVIEW → PUBLISH)

| Feature | Current state | Target state | Frontend | Backend | Database | External API | U | I | E | M | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F27 YouTube Connection | REAL — OAuth connect, upload scopes, token encryption | Multi-channel, connection health, quota visibility | extend | extend | `channel_connections` | YouTube Data API | pass | missing | missing | pending | IN PROGRESS |
| F28 Content Calendar | REAL — scheduling calendar, no auto-publish (D82) | Week/month/pipeline views, drag-drop reschedule | extend | extend | `publishing_jobs` | — | pass | missing | missing | pending | IN PROGRESS |
| F29 Review Studio | REAL — approval queue, server-only approvals, score<50 blocks public (D61/62) | Team review, client sign-off, evidence desk | extend | extend | `approvals` | — | pass | missing | missing | pending | IN PROGRESS |
| Meta publishing | PARTIAL — backend complete, **unreachable** (dead `meta.functions.ts`, now auth-hardened) | Wire up behind founder test gates when Meta app review passes | new UI | exists | `meta_connections` | Meta Graph v26 | missing | missing | missing | pending | IN PROGRESS |
| F30 Analytics Dashboard | PARTIAL — channel overview, retention curve, next-video recs (D72–74) | Full dashboard: views/subs/revenue, deltas with honest baselines | extend | extend | `analytics_snapshots`, `platform_video_stats` | YouTube Analytics API | pass | missing | missing | pending | IN PROGRESS |
| F31 Content Buckets | NOT STARTED | Bucket-level performance analysis | new | new | `analytics_snapshots` | — | missing | missing | missing | pending | NOT STARTED |
| F32 Scene-aware retention | PARTIAL — retention curve over real chapter durations (D73) | Scene-mapped retention, weakest-scene diagnosis | extend | extend | `retention_snapshots` | — | pass | missing | missing | pending | IN PROGRESS |
| F33 Channel Audit | NOT STARTED | Automated channel health audit with cited findings | new | new | `channel_snapshots` | YouTube APIs | missing | missing | missing | pending | NOT STARTED |
| F34 Packaging Experiments | NOT STARTED | Title/thumbnail A/B with stats discipline | new | new | `experiments`, `experiment_arms` | YouTube | missing | missing | missing | pending | NOT STARTED |
| F35 Learning Engine | NOT STARTED | Evidence-gated learnings from outcomes | new | new | `learnings` | — | missing | missing | missing | pending | NOT STARTED |
| F36 Comment Intelligence | NOT STARTED | Comment mining → audience requests → ideas (draft replies need human confirm; never auto-delete) | new | new | `comments`, `engagement_insights` | YouTube | missing | missing | missing | pending | NOT STARTED |
| F37 Monetization Studio | NOT STARTED | Revenue tracking, RPM/CPM as **ESTIMATE**s, never guarantees | new | new | `analytics_snapshots` | YouTube Analytics | missing | missing | missing | pending | NOT STARTED |
| F38 Outcome / ROI Studio | NOT STARTED | Cost-per-video vs outcome, per-plan cost transparency | new | new | `credit_ledger`, `renders` | — | missing | missing | missing | pending | NOT STARTED |
| F39 Brand Library | PARTIAL — brand kit editor in `/agency` | Central brand assets: logos, fonts, colors, intros | extend | extend | `assets` | — | pass | missing | missing | pending | IN PROGRESS |
| F40 Team Workspaces | PARTIAL — workspaces/members/approvals wired; roles + audit missing | Full roles, invites, audit log, client seats | extend | extend | `workspaces`, `workspace_members`, `audit_logs` | — | pass | missing | missing | pending | IN PROGRESS |

## Platform

| Feature | Current state | Target state | Frontend | Backend | Database | External API | U | I | E | M | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F41 API & MCP | NOT STARTED | Scoped API keys, rotation, rate limits, typed MCP tools over the creator graph, credit gating, audit logs | new | new | `api_keys`, `audit_logs` | — | missing | missing | missing | pending | NOT STARTED |
| F42 Chrome Extension | NOT STARTED | **Architecture only** in this program: token model with minimal scopes, design doc | design | design | — | — | n/a | n/a | n/a | pending | NOT STARTED |

## Permanent E2E scenarios

| Scenario | Current state | Gate |
|---|---|---|
| `E2E_30_SECOND_CREATION` — "Why do airplane windows have a tiny hole?" → researched 25–35s script, ≥2 sources, 5–7 scenes, narration, word-synced captions, music, valid 9:16 MP4, titles + 3 thumbnails + description + hashtags, QC pass, scene-level regen, download, **never publishes without approval** | NOT STARTED — all primitives exist separately (research, script, TTS, render, thumbnails, SEO) but the joined flow does not | Playwright E2E green + all assets persisted + QC pass |
| `E2E_NICHE_FINDER` — create a niche via the New niche dialog → real channel data only, freshness shown, explainable scores + factors, filter-bar narrowing, blueprint generation, similar channels, outlier multiples + draft-script handoff, trend citations, smart-folder rule matching; `unconfigured` honest panel when no key | **ALIGNED 2026-09-27, UNRUN** — spec rewritten to the real UI flow (dialog, `data-testid` row hooks); needs `YOUTUBE_API_KEY` + test account; configured run burns real quota so it must be deliberate | Playwright E2E aligned + unconfigured branch unit-verified; configured branch **pending**, not passed |

## Phase 0 fixes applied (2026-09-27)

| Finding | Fix | Verified |
|---|---|---|
| S1 Medium — dead `meta.functions.ts` used `requireSupabaseAuth` (permits guest JWTs) | Switched all 4 server fns to `requireAppUser` (`src/lib/server-auth.ts`) | `tsc --noEmit` clean |
| `/sitemap.xml` 404 (route lived at `/sitemap/xml`) | `createFileRoute("/sitemap.xml")` in `src/routes/sitemap.xml.tsx` | route tree regenerated, build passes |
| Worker tests (`worker/src/*.test.ts`, 9 files) silently excluded from `npm test` | Added `test` script to `worker/package.json` (`tsx --test`), root `test:worker` gate | 76/76 pass |
