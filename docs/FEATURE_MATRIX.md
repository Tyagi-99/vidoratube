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

**Live-verification legend (honest codes):** `live` = exercised against the
real provider with real keys, observed green · `fakes` = tested against
in-test fakes/mocks only, zero network calls · `unconfigured` = code returns
an honest "not configured" envelope without a key; the configured path has
never run · `untested` = no test exists for this path · `design` = docs only,
not implemented · `stub` = placeholder UI or partial shell, not implemented ·
`infra` = infrastructure verified live (DB migration applied,
RLS checked, bundle published) but feature behavior never exercised against it.

**Status rules (per brief):** `COMPLETE` only when the feature's tests pass.
`IN PROGRESS` = exists but incomplete. `NOT STARTED` = not built.
**IMPORTANT: `COMPLETE` in this matrix means code-complete with unit/integration
tests green — it does NOT mean live-verified against real providers. See the
"Live-provider verification ledger" at the end of this file for what has
actually touched a real provider. As of 2026-09-28: no feature has.** Estimates are
labeled **ESTIMATE**; AI conclusions are labeled as such; demo data will be
labeled `DEMO DATA` wherever it appears in product.

*Database COMPLETE = schema coded, RLS-covered, static tests green. Migrations are NOT applied to production (Lovable requires manual apply — see KNOWN_ISSUES.md).
*F10 COMPLETE (Phase 5 Stream A, 2026-09-28): agent loop + `/agent` route shipped and unit-tested (12 new tests; draft-only invariant, preflight-per-turn, 6-iteration cap); migration `20260928050000_p5_agent.sql` applied live 2026-09-28 (verified in pg_catalog) — the `/agent` route itself is not yet browser-verified (no live-browser access in this program).

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
| F10 Vidora Agent | REAL (code) — tool-calling conversational strategist (`src/lib/agent/`): 8 pinned MCP tools via the Supabase MCP port (no duplicated logic), credit preflight per LLM turn (jobType `llm_chat`, debit-first), draft-only invariant (results asserted `status === "draft"`, else `invariant_violated`), max 6 tool iterations, `agent.tool_call` audit rows, assistant messages labeled "AI analysis"; honest unconfigured/insufficient-credits states; `/agent` route with conversation list + thread; `agent_conversations`/`agent_messages` owner-RLS tables (migration `20260928050000_p5_agent.sql`, unapplied) | Tool-calling conversational strategist; every recommendation ends in a real project with real costs + approval gates | done | done | `agent_conversations`, `agent_messages` | LLM (Lovable AI gateway) | pass (12 new) | missing | missing | pending (migration + browser check) | COMPLETE* |
| F11 Deep Research | REAL (code) — Evidence Desk: deterministic claim extraction (read-only), keyword-overlap source linking, explicit confirm/waive, strict-mode toggle; D105 semantics (waived still blocks); strict gate blocks script approval + publish approval + publish execution; client-side package export gate | Claim-level citations, evidence desk, strict mode blocks unsupported claims | done | done | `research_sources`, `research_claims` (+ review columns) | search provider | pass (18 claims + 7 evidence + 6 gate + 7 publish-gate) | missing | missing | pending | COMPLETE (code; migration apply pending) |
| F12 Script Studio | REAL (code) — section editor, append-only versions, diff/restore, 150wpm ESTIMATE timing, brand-voice binding (vocabulary carried into prompt), draft→review→approve→lock (server-enforced), preflight-gated AI draft (1 credit, debit-before-persist, ProviderResult envelope) | Section-based editor, version history, timing, brand-voice binding | done | done | `scripts`, `script_versions` | LLM | pass (33 new) | missing | missing | pending | COMPLETE (code; migration apply pending) |
| F13 Brand Voice | REAL (code) — owner-scoped CRUD on `brand_profiles`, vocabulary normalization, `resolveBrandProfileForUser` binding helper for Script Studio (explicit id wins; exactly-one auto-select; multi-profile ambiguity → null, no guessing); no LLM calls yet — profiles are data + binding only | Voice profiles bound to script generation | done | done | `brand_profiles` (existing) | — | pass (13 new) | missing | missing | done | COMPLETE |
| F14 Title Lab | REAL (code) — deterministic template-based variant generation (no LLM spend, D101), pinned `TitleScore` factors (length/keyword/curiosity/clarity, D94 ESTIMATE labels), weak-evidence → neutral keyword score, framed as packaging heuristics never CTR predictions; status flow draft→testing→winner/retired, one-winner invariant, experiment creation (draft + even-split arms, Phase 4 runs/reads them) | Stats-disciplined title variants + experiments | done | done | `title_variants`, `experiments`, `experiment_arms` | — | pass (22 new) | missing | missing | done | COMPLETE |
| F15 Thumbnail Studio | REAL — layered canvas editor (text/image layers, 16:9 + 9:16, backgrounds, z-order), project draft→in_review→approved flow, 1–8 AI variants with credit preflight (honest unconfigured state, no fake images), compare + winner selection, Phase-4 experiment-arm linkage; routes `/thumbnails`, `/characters` nav, dev-curl verified 200 | Layered editor, A/B variants, CTR experiment linkage | extend | extend | `thumbnail_projects`, `thumbnails` (canonical variants), `experiment_arms.thumbnail_id` | image gen | pass (31 new) | pass (envelope) | missing | pending | COMPLETE* |
| F16 Character System | REAL — CRUD + style notes, validated reference upload (JPEG/PNG/WebP ≤ 5 MB, private `generated-videos` bucket, signed previews), binding via `scenes.metadata.character_id` with usage lookup; UI states “Reference attached — visual consistency across scenes is not yet verified” everywhere a reference is shown | Consistent characters across scenes (pending proof render) | new | new | `characters`, `scenes.metadata` | image gen | pass (16 new) | pass (envelope) | missing | pending | IN PROGRESS* |
| F17 Voice Studio | REAL — `/voices` studio: provider status (ElevenLabs/OpenAI/gateway), voice library CRUD (built-in catalog read-only + user voices), sample upload w/ server-side validation, clone w/ legal gate, text→speech via ElevenLabs→OpenAI→gateway fallback chain, durable job + credit preflight, audio preview/download. Live provider verification founder-blocked (no keys in dev). | Multi-provider voice studio, uploads, cloning where legal | extend | extend | `voices` (+ user index) | ElevenLabs, OpenAI TTS | pass | pass | missing | pending | COMPLETE |
| F18 Stock Media | REAL — `StockPicker`: Pexels→Pixabay search, honest "stock provider not connected" state (zero network calls), explicit opt-in mock previews (D48 labels kept), per-asset rights tracking (`asset_provenance`, `content_assets.technical_metadata.rights`, `scenes.asset_source`). Real keys founder-blocked. | Licensed stock with rights tracking per asset | extend | extend | `content_assets`, `asset_provenance` | Pexels, Pixabay | pass | pass | missing | pending | COMPLETE |
| F19 Short-Form Engine | PARTIAL — quote UI disabled, labeled "Shipping next (target Oct 2026)" | Shorts generation + repurposing pipeline | new | new | `scenes`, `renders` | video gen | missing | missing | missing | pending | IN PROGRESS |
| F20 Video Studio | REAL (code) — Studio route `/_authenticated/studio/$projectId`: per-scene edit/regen (audio via TTS, visual via image gen, free timing fix), QC (`qcStudioTimeline` → pinned `QCResult`), pinned `SceneManifest` via `buildSceneManifest`/`manifestFromStudioScenes`, enqueue via existing `enqueueServerRender` (durable jobs + credit gate intact); explicit `asplit=2` voice-bus split (D99) in app + worker | Scene-based studio, per-scene regen, music ducking | extend (route + RenderPanel passthrough props) | extend | `scenes`, `scene_versions`, `renders` | ElevenLabs, fal.ai | pass (39 creation + 11 audio) | missing | missing | done | IN PROGRESS |
| F21 Render Checkpoints | REAL (code) — app: scene checkpoints in `generation_jobs.checkpoint.studio` (done/failed, first-incomplete, one-scene repair invalidation) + `repairScene` kinds (narration/audio/visual/timing, timing free); worker: per-segment completion in `renders.checkpoint.segments` with server-read/resume + `markSegmentDone` per scene, stale-local-segment cleanup; two stores intentionally separate (D100) | Durable checkpoints, scene-level repair, resume after restart/closed browser | extend | extend | `generation_jobs`, `renders` | — | pass (10 segment-checkpoint + 39 creation) | missing | missing | done | IN PROGRESS |
| F22 Production Readiness | REAL — `/status` runs real system checks | Expanded diagnostics: provider health, queue depth, cost, render metrics | extend | extend | — | all | pass | missing | missing | pending | IN PROGRESS |
| F23 30-sec Quick Create | REAL (code) — `/create/quick-create`: 11-stage pipeline (idea→research→script→scenes→voiceover→visuals→assemble→QC→captions→music→render); F8 idea scoring, F11 claim→source linking, Stream E manifest/QC; paid stages honest skips (`skipped_unconfigured` / `skipped_needs_spend_approval` + ESTIMATE, D131); render stage never enqueues by itself — human "Enqueue real render" button calls existing `enqueueServerRender` (D132); stops at download, never publishes; `quick_create_runs` table (migration unapplied) | One input → researched, cited, captioned 9:16 video in one flow (**E2E_30_SECOND_CREATION**) | new (route + pipeline lib) | new | `quick_create_runs` (+ all creation tables) | all (honest skip w/o keys) | pass (36 new incl. 11 E2E) | pass (envelope) | missing | pending (migration) | COMPLETE* |
| F24 Shorts Repurposing | REAL (code) — `planShort`: rule-based (not AI) hook-first resequencing, tightened narration, 9:16, duration cap, quote; enqueue as `kind: "short"` via existing `enqueueServerRender`; `parent_id` = optional source render (self-FK to `renders.id`, D102), project linkage via `project_id`; optional "cut from finished render" picker; never auto-publishes | Long-form → shorts with hooks recut | extend (Studio Shorts tab) | extend | `renders`, `scenes` | — | pass (shorts plan tests in creation suite) | missing | missing | done | IN PROGRESS |
| F25 Idea → Campaign | REAL (code) — deterministic campaign package builder (longform/shorts/thumbnail_set/titles/metadata); artifacts start `planned` with `ref: null` (D102, no fabricated references); real refs linkable later; status flow draft→in_production→ready enforced | One idea → multi-format campaign (long + shorts + thumbnails + titles) | done | done | `content_packages` (existing) | — | pass (16 new) | missing | missing | done | COMPLETE |
| F26 SEO & Metadata | REAL (code) — `/create/seo-studio`: deterministic package builder reusing Title Lab engine (`generateTitleVariants` + `scoreTitle`, D133); description/hashtag templates, exactly 3 thumbnail *concepts* (composition + ≤4-word overlay + rationale, never generated images, no CTR claims); brand profile reuse; export runs the real strict gate (`getProjectStrictGate`) with blocked envelope; `seo_packages` table applied live 2026-09-28 | Full SEO studio, hashtag/tag strategy, upload presets | new (route + seo lib) | new | `seo_packages` | — | pass (12 new) | pass (envelope) | missing | pending | COMPLETE* |

\* **F15 COMPLETE** (Phase 3 Stream C, 2026-09-28): all Stream C scope shipped and unit/integration-tested (47 new tests); CTR metrics on experiment arms belong to Phase 4. **F16 IN PROGRESS** (Phase 3 Stream C, 2026-09-28): character CRUD, reference upload, and scene binding are complete and tested (16 new tests); the outstanding target is the six-scene proof render that proves visual consistency — no consistency claim is made until it passes (see KNOWN_ISSUES.md). **F23/F26 COMPLETE\*** (Phase 3 Stream F, 2026-09-28): Quick Create pipeline + SEO Studio shipped and tested (48 new tests); migration `20260928041400_p3_stream_f.sql` applied live 2026-09-28 (verified, see KNOWN_ISSUES.md).

## Operations (REVIEW → PUBLISH) — Phase 4 shipped 2026-09-28 (all unit tests green; live integration founder-gated)

| Feature | Current state | Target state | Frontend | Backend | Database | External API | U | I | E | M | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F27 YouTube Connection | REAL (code) — OAuth connect, upload scopes, token encryption, connection health, quota visibility; publish jobs idempotent (`idempotency_key` unique, backfilled), transient-failure retry | Multi-channel polish | done | done | `channel_connections`, `publish_jobs.idempotency_key` | YouTube Data API | pass (~36) | missing | missing | pending | COMPLETE |
| F28 Content Calendar | REAL (code) — scheduling calendar, no auto-publish; week/month/pipeline views, drag/drop reschedules only `scheduled_for` | Reminders | done | done | `publishing_jobs` | — | pass | missing | missing | pending | COMPLETE |
| F29 Review Studio | REAL (code) — approval queue, server-only approvals, score<50 blocks public (D61/62); rejection is terminal with immutable reason + audit row; live-metadata overwrite needs diff + human confirm bound to fresh snapshot hash (TOCTOU, D166) | Evidence desk polish | done | done | `approvals`, `audit_logs` | — | pass | missing | missing | pending | COMPLETE |
| Meta publishing | PARTIAL — backend complete, **unreachable** (dead `meta.functions.ts`, now auth-hardened) | Wire up behind founder test gates when Meta app review passes | new UI | exists | `meta_connections` | Meta Graph v26 | missing | missing | missing | pending | IN PROGRESS |
| F30 Analytics Dashboard | REAL (code) — ingestion with REQUIRED `source` (fixture default → DEMO DATA labels, D167), honest 28d deltas ("insufficient history" without baseline, D168) | Live YouTube Analytics ingestion | done | done | `analytics_snapshots` | YouTube Analytics API | pass (~53) | missing | missing | pending | COMPLETE |
| F31 Content Buckets | REAL (code) — bucket-level performance derived from project metadata, never invented labels (D169) | Cross-channel buckets | done | done | `analytics_snapshots` | — | pass | missing | missing | pending | COMPLETE |
| F32 Scene-aware retention | REAL (code) — retention curve over real chapter durations; weakest-scene diagnosis from real points only (D170) | Scene-mapped retention heatmap | done | done | `retention_snapshots` | — | pass | missing | missing | pending | COMPLETE |
| F33 Channel Audit | REAL (code) — automated channel health audit; findings descriptive or AI-labeled, always evidenced (D171) | Scheduled audits | done | done | `channel_snapshots` | YouTube APIs | pass | missing | missing | pending | COMPLETE |
| F34 Packaging Experiments | REAL (code) — title/thumbnail A/B with sample-size floors and 24h minimum before any conclusion; stats discipline | Auto-winner rollout | done | done | `experiments`, `experiment_arms` | YouTube | pass (~40) | missing | missing | pending | COMPLETE |
| F35 Learning Engine | REAL (code) — evidence-gated learnings from outcomes; topic-grouped; AI-mined learnings labeled "AI analysis" (D171) | Cross-project patterns | done | done | `learning_insights` | — | pass (~17) | missing | missing | pending | COMPLETE |
| F36 Comment Intelligence | REAL (code) — comment mining → audience requests → ideas; rule-based sentiment/question classification at ingest (AI deferred and labeled, D136); question feed; draft replies need human confirm; never auto-delete; exactly-once notifications via `dedup_key` | AI classifiers behind same signature | done | done | `comments`, `notifications` | YouTube | pass (~32) | missing | missing | pending | COMPLETE |
| F37 Monetization Studio | REAL (code) — revenue tracking; RPM/CPM always **ESTIMATE**, never guarantees (D172) | Live revenue sync | done | done | `monetization_settings`, `analytics_snapshots` | YouTube Analytics | pass | missing | missing | pending | COMPLETE |
| F38 Outcome / ROI Studio | REAL (code) — cost-per-video = net ledger credits (refunds counted), unattributed spend visible; USD at per-plan rates (D173) | Attribution depth | done | done | `credit_ledger`, `renders` | — | pass | missing | missing | pending | COMPLETE |
| F39 Brand Library | REAL (code) — central brand assets (`brand_assets`, workspace-scoped) | Font/color sync to Studio | done | done | `brand_assets` | — | pass (~10) | missing | missing | pending | COMPLETE |
| F40 Team Workspaces | REAL (code) — roles + audit (Phase 1) + invites (`workspace_invites`, Stream E) | Client seats polish | done | done | `workspaces`, `workspace_members`, `workspace_invites`, `audit_logs` | — | pass (~5) | missing | missing | pending | COMPLETE |

## Platform

| Feature | Current state | Target state | Frontend | Backend | Database | External API | U | I | E | M | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F41 API & MCP | REAL (code) — scoped API keys (hash-only storage, revocable, `last_used_at` tracking, rotate endpoint + settings-UI rotation UX), JSON-RPC 2.0 MCP server over HTTP POST, authenticated + audited (D160); standard `X-RateLimit-*` headers on `/api/mcp` + `/api/keys*` (D178); credit-gating audit: only `draft_script` generate spends (real preflight + debit, D180); permanent E2E harness `src/lib/mcp/e2e.test.ts` drives all 8 tools through the real JSON-RPC envelope (D179) | Rotation, rate limits, credit gating | done | done | `api_keys`, `audit_logs` | — | pass (~61) | missing | missing | pending | COMPLETE |
| F42 Chrome Extension | DESIGN (docs) — architecture + token model in `docs/CHROME_EXTENSION.md`; SSO/SAML + DPA + residency notes in `docs/ENTERPRISE.md` | **Architecture only** in this program: token model with minimal scopes, design doc | design | design | — | — | n/a | n/a | n/a | pending | COMPLETE (design) |

## Permanent E2E scenarios

| Scenario | Current state | Gate |
|---|---|---|
| `E2E_30_SECOND_CREATION` — "Why do airplane windows have a tiny hole?" → researched 25–35s script, ≥2 sources (3 exact URLs: Gizmodo, scienceblog, Family Handyman), 5–7 scenes, pinned SceneManifest, scene-level regen, word-synced ESTIMATE captions, honest paid-stage skips with ESTIMATEs, SEO package (titles + 3 thumbnail concepts + description + hashtags), Stream E QC (fails honestly w/o visuals, passes with), **never publishes without approval** | DONE (code, 2026-09-28, Stream F) — 11 pure-function tests green; paid stages skip honestly; real render path verified via existing enqueue only | `src/lib/creation/quick-create/e2e-30-second.test.ts` green (11/11) + all assets persisted via `quick-create.functions.ts` (needs applied migration) |
| `E2E_NICHE_FINDER` — create a niche via the New niche dialog → real channel data only, freshness shown, explainable scores + factors, filter-bar narrowing, blueprint generation, similar channels, outlier multiples + draft-script handoff, trend citations, smart-folder rule matching; `unconfigured` honest panel when no key | **ALIGNED 2026-09-27, UNRUN** — spec rewritten to the real UI flow (dialog, `data-testid` row hooks); needs `YOUTUBE_API_KEY` + test account; configured run burns real quota so it must be deliberate | Playwright E2E aligned + unconfigured branch unit-verified; configured branch **pending**, not passed |

## Phase 0 fixes applied (2026-09-27)

| Finding | Fix | Verified |
|---|---|---|
| S1 Medium — dead `meta.functions.ts` used `requireSupabaseAuth` (permits guest JWTs) | Switched all 4 server fns to `requireAppUser` (`src/lib/server-auth.ts`) | `tsc --noEmit` clean |
| `/sitemap.xml` 404 (route lived at `/sitemap/xml`) | `createFileRoute("/sitemap.xml")` in `src/routes/sitemap.xml.tsx` | route tree regenerated, build passes |
| Worker tests (`worker/src/*.test.ts`, 9 files) silently excluded from `npm test` | Added `test` script to `worker/package.json` (`tsx --test`), root `test:worker` gate | 76/76 pass |

## Live-provider verification ledger (added 2026-09-28, Phase 6 Stream D)

Per-feature real-provider verification state, from what I could inspect in
this worktree. Codes: see the legend at the top of this file. This ledger is
the only place in the repo that answers "has it touched a real provider?" —
everything else in this matrix is code + unit/integration green.

| Feature | Real-provider state | Evidence |
|---|---|---|
| Auth | `infra` — live site published; no authenticated session observed in this program | No authenticated browser E2E ever ran (no test credentials); Supabase Auth config itself unverified live |
| Workspace / Credits / Jobs (durable) | `fakes` — unit-tested with injected fakes; no live behavior observed | `vitest` green; worker never deployed |
| Database | `infra` — 38/38 expected tables applied live 2026-09-28, `vector` ext installed, RLS verified on new tables, 24/24 key columns | Dashboard read queries; `docs/PHASE4_MIGRATION_LIST.md` |
| Render worker / server FFmpeg (F20/F21/F24) | `untested` live — never deployed; no heartbeat ever recorded | `worker/benchmark-results.md`: real FFmpeg but synthetic assets only (no TTS/LLM/image, no Supabase upload); `worker/scripts/e2e-verify.ts` exists — no record of a run found |
| F1–F7 Intelligence | `unconfigured` — no `YOUTUBE_API_KEY` anywhere in this environment | Honest unconfigured envelope unit-verified (zero network calls, zero quota); configured Playwright branch never run |
| F8 Ideas / F13 Brand Voice / F14 Title Lab / F25 Campaigns | `fakes` / pure deterministic — no provider involved | Pure functions + fake-DB tests; nothing to go live against |
| F9 Visual Research / F11 Deep Research | `fakes` — search-provider integration shell, no key | Deterministic claim extraction; no live search call |
| F10 Vidora Agent | `unconfigured` — no `LOVABLE_API_KEY` in this environment; `/agent` route never browser-verified | MCP E2E harness drives 8 tools through JSON-RPC against a **sandbox fake port**, not real providers |
| F12 AI script draft | `unconfigured` — configured path (real LLM + 1-credit debit) mocked only | Unconfigured envelope unit-verified, zero network |
| F15 Thumbnail Studio | `unconfigured` — no image-provider key | `image_provider_unconfigured` unit-tested: zero network calls, zero fabricated images |
| F16 Character System | `fakes` + proof render `untested` | 6-scene proof render never run (KNOWN_ISSUES.md #10) |
| F17 Voice Studio | `unconfigured` — no ElevenLabs/OpenAI keys; TTS chain `fakes` only | Real-API verification (audio quality, license fields) founder-gated; **the catalog's `verified: true` voice IDs were never checked against the ElevenLabs API in this program** — a wrong ID fails as a provider 404 at first real TTS call (see KNOWN_ISSUES.md) |
| F18 Stock Media | `unconfigured` — no Pexels/Pixabay keys | Honest "not connected" state unit-verified, zero network |
| F19 Short-Form Engine | `stub` — quote UI disabled, labeled "Shipping next (target Oct 2026)" | Not implemented |
| F22 /status | `untested` on live site in this program | Server checks read live Supabase through service role; nobody has verified the published page's "Render worker" row flips from "no heartbeat recorded yet" |
| F23 Quick Create paid paths | `unconfigured` — only honest-skip branches unit-verified | TTS/image/render real calls founder-gated (keys + spend approval) |
| F26 SEO Studio | `fakes` — deterministic, no provider | — |
| F27 YouTube OAuth / upload | `unconfigured` — OAuth flow never completed; no test channel connected | Code complete, idempotency + retry unit-tested; publish against a real account never attempted |
| F28–F29 / F31–F39 (calendar, approvals, analytics, retention, audit, experiments, learnings, monetization, ROI, brand library) | `fakes` — live ingestion needs YouTube APIs | Unit-verified with fixtures; analytics rows labeled DEMO DATA when source=fixture |
| F30 Analytics ingestion | `fakes` / `unconfigured` — no YouTube Analytics API key | REQUIRED `source` column; honest "insufficient history" deltas |
| F36 Comment ingestion | `fakes` / `unconfigured` — no YouTube API key | Rule-based classifiers deterministic; AI deferred |
| F40 Team invites | `fakes` — email delivery path unverified | `workspace_invites` table applied; no live invite observed |
| F41 API & MCP | `fakes` — sandbox fake port, no real consumer | `src/lib/mcp/e2e.test.ts` green; rate-limit headers unit-tested |
| F42 Chrome Extension | `design` — docs only | `docs/CHROME_EXTENSION.md` |
| Payments (Dodo/Razorpay) | `unconfigured` — no live keys; checkout buttons read "Coming soon" | Code switches on env-key presence (`src/components/vidora/PricingSection.tsx`); webhook signature tests use stubbed env |
| Playwright E2E (`e2e/`, 5 specs) | `untested` in this program — authenticated specs self-skip without `TEST_USER_EMAIL`/`TEST_USER_PASSWORD` + `YOUTUBE_API_KEY` | No authenticated browser E2E has ever run; public specs have no run record either |

**Bottom line:** as of 2026-09-28, **zero features have been verified against a
live external provider.** Everything provider-shaped is either fakes/mocks in
tests or an honest unconfigured envelope. The live-verified surface is
infrastructure only: migrations applied, RLS checked, bundle published.
