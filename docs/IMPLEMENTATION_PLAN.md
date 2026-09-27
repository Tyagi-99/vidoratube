# Vidora OS — Phased Implementation Plan

2026-09-27. Builds on `docs/FEATURE_MATRIX.md`, `docs/PRODUCT_AUDIT.md`, and
`docs/COMPETITOR_RESEARCH.md`. Preserves the existing stack
(TanStack Start + React 19 + Supabase/Postgres + Lovable AI gateway +
ElevenLabs + browser-render fallback) — see D88 in `docs/DECISIONS.md`.

**Global rules for every phase:**
- No feature marked COMPLETE until its U/I/E/M tests pass (matrix updated).
- Real / stored / **ESTIMATE** / AI-interpreted / `DEMO DATA` always distinguished.
- "AI prepares. Human approves." — no silent live mutations, no auto-publish.
- End of each phase: lint, typecheck, unit, integration, E2E, fix failures, update matrix.
- Migrations are forward-only; Lovable does not auto-apply them (apply via
  dashboard SQL editor in filename order, then verify via `information_schema`).

## Phase 1 — Foundation

Scope: Auth hardening, workspace roles + `audit_logs`, new database entities,
durable jobs, credit budgets, provider interfaces.

1. **Workspace roles & audit** — `workspace_members` role checks per operation
   (Owner/Admin/Strategist/Creator/Viewer/Client), `audit_logs` table, admin 403 page (S2).
2. **Database** — migrations for `niches`, `channels`, `channel_snapshots`,
   `competitor_channels`, `videos`, `video_snapshots`, `research_sources`,
   `research_claims`, `folders`, `folder_rules`, `folder_items`, `ideas`,
   `projects`, `scripts`, `script_versions`, `brand_profiles`, `characters`,
   `voices`, `assets`, `scenes`, `scene_versions`, `generation_jobs`,
   `provider_tasks`, `renders`, `thumbnail_projects`, `thumbnail_variants`,
   `title_variants`, `content_packages`, `publishing_jobs`,
   `analytics_snapshots`, `retention_snapshots`, `experiments`,
   `experiment_arms`, `learnings`, `comments`, `engagement_insights`,
   `api_keys`, `audit_logs` (new), `subscriptions`. pgvector for research/idea
   embeddings. DB cron owner for `requeue_stale_renders`.
3. **Jobs** — deploy render worker (heartbeat = existing founder blocker),
   checkpoint/resume tables, scene-level repair, provider task ID persistence,
   idempotency keys, cost tracking per job.
4. **Credits** — cost estimates before expensive ops, balance checks,
   workspace/project budgets, fallback policy, usage logs.
5. **Providers** — formal `Text/Image/Video/TTS/Research/Storage` interfaces
   with model, task ID, latency, cost, status, error, usage on every output;
   wire transcription + search providers (currently contract-only); video-gen
   fallback beside fal.ai.

Exit: matrix Foundation rows → COMPLETE; worker heartbeat live; new tables RLS-covered.

## Phase 2 — Intelligence (F1–F7)

Channel ingestion via YouTube Data API (quota-aware, cached snapshots) →
Niche Finder with explainable scoring → Channel Blueprints → Channel Explorer
+ comparisons → Outlier Explorer (scores, velocity, ideation-card handoff) →
Video Intelligence + 3-video compare → Trend Radar (multi-source, cited) →
Smart Folders.

Exit: `E2E_NICHE_FINDER` green; no placeholder channels; `INSUFFICIENT DATA`
states verified.

## Phase 3 — Creation (F8–F26)

Ideas (evidence-backed engine over existing `video_ideas`) → Visual Research
canvas → Script Studio (section-based, history, timing) + Brand Voice →
Title Lab → Thumbnail Studio (layered editor) → Character System (only after
6-scene proof render) → Voice Studio → Stock Media (rights tracking) →
Video Studio (scene-based, checkpoints, per-scene repair) → 30-sec Quick
Create → Shorts repurposing → Idea→Campaign → SEO/Metadata.

Exit: `E2E_30_SECOND_CREATION` green — real 9:16 MP4, cited script,
persisted assets, QC pass, approval gate enforced.

## Phase 4 — Operations (F27–F40)

Review Studio (team + client sign-off + evidence desk) → Calendar
(week/month/pipeline, drag-drop) → YouTube (multi-channel, quota) →
Publishing (existing gates preserved) → Shorts pipeline → Metadata studio →
Analytics dashboard → Content buckets → Scene-aware retention → Channel audit
→ Packaging experiments → Learning engine → Comment intelligence (drafts need
human confirm; never auto-delete) → Monetization (**ESTIMATE**s only) →
ROI studio → Brand Library → Team workspaces.

Exit: publish flow E2E green with approval enforcement; analytics show honest
empty states on thin data.

## Phase 5 — Platform (F10, F41–F42)

Vidora Agent (tool-calling, grounded in the real pipeline) → scoped API keys
(rotation, rate limits) → MCP server (typed tools, credit gating, audit logs)
→ Enterprise (SSO/SAML, DPA, data residency notes) → Chrome extension
**architecture + token model only**.

Exit: MCP tools E2E-tested against a sandbox workspace; extension design doc
reviewed.

## Pricing (open decision, founder)

Live plans (Starter $19 / Studio $49 / Scale $149) vs brief (Free / Creator /
Pro / Studio / Enterprise) vs original investor brief. Do not guess — the
credit-ledger + budgets work in Phase 1 must support either. Founder picks
before Phase 4 billing UI changes.
