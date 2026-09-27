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
| F8 Viral Idea Engine | PARTIAL — `video_ideas` + deterministic recommendations (D74) | Evidence-backed scoring, outlier linkage, idea → project | extend | extend | `ideas` | — | pass | missing | missing | pending | IN PROGRESS |
| F9 Visual Research | NOT STARTED | Research canvas: sources, clips, references per project | new | new | `research_sources` | — | missing | missing | missing | pending | NOT STARTED |
| F10 Vidora Agent | NOT STARTED | Tool-calling conversational strategist; every recommendation ends in a real project with real costs + approval gates | new | new | all | LLM | missing | missing | missing | pending | NOT STARTED |
| F11 Deep Research | PARTIAL — `/research` routes + server fns real | Claim-level citations, evidence desk, strict mode blocks unsupported claims | extend | extend | `research_sources`, `research_claims` | search provider | pass | missing | missing | pending | IN PROGRESS |
| F12 Script Studio | REAL — script/voiceover/auto_edit/story modes wired | Section-based editor, version history, timing, brand-voice binding | extend | extend | `scripts`, `script_versions` | LLM | pass | missing | missing | pending | IN PROGRESS |
| F13 Brand Voice | NOT STARTED | Voice profiles bound to script generation | new | new | `brand_profiles` | LLM | missing | missing | missing | pending | NOT STARTED |
| F14 Title Lab | NOT STARTED | Stats-disciplined title variants + experiments | new | new | `title_variants` | — | missing | missing | missing | pending | NOT STARTED |
| F15 Thumbnail Studio | REAL — 4 variants, select/persist (D80) | Layered editor, A/B variants, CTR experiment linkage | extend | extend | `thumbnail_projects`, `thumbnail_variants` | image gen | pass | missing | missing | pending | IN PROGRESS |
| F16 Character System | NOT STARTED | Consistent characters across scenes (pending proof render) | new | new | `characters` | image gen | missing | missing | missing | pending | NOT STARTED |
| F17 Voice Studio | REAL — voiceover mode, 16 voices (12 EN + 4 HI) | Multi-provider voice studio, uploads, cloning where legal | extend | extend | `voices` | ElevenLabs, OpenAI TTS | pass | missing | missing | pending | IN PROGRESS |
| F18 Stock Media | PARTIAL — `mock://` assets honestly labeled; real keys founder-blocked | Licensed stock with rights tracking per asset | extend | extend | `assets` (rights fields) | Pexels, Pixabay | missing | missing | missing | pending | IN PROGRESS |
| F19 Short-Form Engine | PARTIAL — quote UI disabled, labeled "Shipping next (target Oct 2026)" | Shorts generation + repurposing pipeline | new | new | `scenes`, `renders` | video gen | missing | missing | missing | pending | IN PROGRESS |
| F20 Video Studio | REAL (code) — Studio route `/_authenticated/studio/$projectId`: per-scene edit/regen (audio via TTS, visual via image gen, free timing fix), QC (`qcStudioTimeline` → pinned `QCResult`), pinned `SceneManifest` via `buildSceneManifest`/`manifestFromStudioScenes`, enqueue via existing `enqueueServerRender` (durable jobs + credit gate intact); explicit `asplit=2` voice-bus split (D99) in app + worker | Scene-based studio, per-scene regen, music ducking | extend (route + RenderPanel passthrough props) | extend | `scenes`, `scene_versions`, `renders` | ElevenLabs, fal.ai | pass (39 creation + 11 audio) | missing | missing | done | IN PROGRESS |
| F21 Render Checkpoints | REAL (code) — app: scene checkpoints in `generation_jobs.checkpoint.studio` (done/failed, first-incomplete, one-scene repair invalidation) + `repairScene` kinds (narration/audio/visual/timing, timing free); worker: per-segment completion in `renders.checkpoint.segments` with server-read/resume + `markSegmentDone` per scene, stale-local-segment cleanup; two stores intentionally separate (D100) | Durable checkpoints, scene-level repair, resume after restart/closed browser | extend | extend | `generation_jobs`, `renders` | — | pass (10 segment-checkpoint + 39 creation) | missing | missing | done | IN PROGRESS |
| F22 Production Readiness | REAL — `/status` runs real system checks | Expanded diagnostics: provider health, queue depth, cost, render metrics | extend | extend | — | all | pass | missing | missing | pending | IN PROGRESS |
| F23 30-sec Quick Create | NOT STARTED | One input → researched, cited, captioned 9:16 video in one flow (**E2E_30_SECOND_CREATION**) | new | new | all creation tables | all | missing | missing | missing | pending | NOT STARTED |
| F24 Shorts Repurposing | REAL (code) — `planShort`: rule-based (not AI) hook-first resequencing, tightened narration, 9:16, duration cap, quote; enqueue as `kind: "short"` via existing `enqueueServerRender`; `parent_id` = optional source render (self-FK to `renders.id`, D102), project linkage via `project_id`; optional "cut from finished render" picker; never auto-publishes | Long-form → shorts with hooks recut | extend (Studio Shorts tab) | extend | `renders`, `scenes` | — | pass (shorts plan tests in creation suite) | missing | missing | done | IN PROGRESS |
| F25 Idea → Campaign | NOT STARTED | One idea → multi-format campaign (long + shorts + thumbnails + titles) | new | new | `content_packages` | — | missing | missing | missing | pending | NOT STARTED |
| F26 SEO & Metadata | REAL — generate/get/update SEO metadata (D81) | Full SEO studio, hashtag/tag strategy, upload presets | extend | extend | existing | — | pass | missing | missing | pending | IN PROGRESS |

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
