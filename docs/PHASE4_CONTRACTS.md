# Phase 4 — Shared Contracts (PINNED)

2026-09-28. All Phase 4 streams MUST follow these contracts. Do not change
the vocab without a new D-decision and coordinator approval.

## Canonical tables (do NOT rename, do NOT create parallel tables)

- `publish_jobs` — plan name `publishing_jobs`. Status CHECK:
  `draft | approved | scheduled | uploading | published | failed | canceled`.
  There is NO `pending_review` value — review workflow lives in the `approvals`
  table; `publish_jobs.approved_by/approved_at` is the gate source of truth
  (see `src/lib/publishing-gates.server.ts`).
- `learning_insights` — plan name `learnings`. Status:
  `proposed | validated | refuted | archived`. Only `validated` learnings may
  feed brief advice.
- `experiments` — status: `draft | running | completed | archived`.
  `experiment_arms` — `control | variant`.
- `analytics_snapshots` — `metrics` jsonb; `revenue_usd` + `revenue_basis`
  (`measured | estimate`; default `estimate` — never show revenue as measured
  without a source).
- `retention_snapshots` — `points: [{t, r, scene_id?}]`, `weakest_scene`.
- `comments` — sentiment: `positive | neutral | negative | mixed | null`;
  UNIQUE(user_id, platform, external_comment_id).
- `engagement_insights` — kind:
  `audience_request | question | sentiment_shift | top_commenter | trend`.
- `api_keys` — stores `key_hash` ONLY. Raw key shown once at creation.
- `notifications` — `type | title | body | link | read_at`.
- `channel_connections` — F27 multi-channel registry.
- `approvals` — server-enforced approval records (D61).

## Metrics vocab (analytics_snapshots.metrics keys)

`views, likes, comment_count, watch_time_minutes, avg_view_duration_s, ctr,
impressions, subscribers_gained`. Source label REQUIRED on every snapshot:
`source ∈ youtube_analytics | meta_insights | fixture`. Fixtures must render
with a visible `DEMO DATA` / `FIXTURE` label in UI.

## Publish pipeline states

`draft → approved → scheduled → uploading → published`
`draft/approved/scheduled → canceled`, any → `failed` (with `error` text).
Scheduling: `scheduled_for` set + status `scheduled`. The calendar reads
`scheduled_for`. Upload executes ONLY when
`assertPublishJobApproved` passes (test-account gate + approval gate).
Never silently overwrite live metadata: fetch current remote title/description
first; if different, require explicit human confirm (record in audit_logs).

## Experiment stats discipline

- `primary_metric ∈ ctr | views | avg_view_duration_s | watch_time_minutes`.
- Minimum sample per arm: 100 impressions (configurable per experiment,
  never lower without a D-decision).
- Significance: two-proportion z-test for CTR, p < 0.05; t-test for continuous.
- NO auto-conclude before min sample AND min duration (24h). Conclusion shape:
  `{ winner_arm_id, p_value, method, decided_at, decided_by: 'human'|'auto' }`.
- Auto-conclude NEVER applies the winner to the live video — a human clicks
  "Apply winner", which is audit-logged.

## Learning evidence gate

`learning_insights.evidence` shape:
`{ type: 'experiment_outcome'|'before_after'|'comment_signal'|'manual',
refs: [row ids], metrics: {...}, sample: n }`.
A learning without evidence stays `proposed`. `confidence` 0–1 required to
leave `proposed`. AI-mined learnings are labeled "AI analysis".

## Comment safety

Draft replies live in `comments.metadata.draft_reply`:
`{ text, status: 'draft'|'approved'|'posted', approved_by, posted_at }`.
Posting requires human approval (server-enforced). Comments are NEVER
auto-deleted — no code path may call a platform delete on comments.

## API keys

- Format: `vdsk_` + 32 URL-safe random chars. Header:
  `Authorization: Bearer vdsk_...`. Store SHA-256 hash only.
- Scope vocab: `read:projects | write:projects | read:analytics |
  publish:request | admin:keys`. `publish:request` creates a publish_job in
  `draft` only — it can NEVER publish.
- Default 60 req/min; every authenticated call writes an `audit_logs` row
  (batched, not per-row when >10/min — see rate-limit decision D-to-come).

## MCP server (F41, pulled into Phase 4 per parent directive)

Typed tools, all keyed by API key, all audit-logged, all mutations gated:
`vidora.search_channels`, `vidora.get_channel`, `vidora.list_projects`,
`vidora.get_project`, `vidora.draft_script` (creates draft script only),
`vidora.request_publish` (draft publish_job only), `vidora.get_analytics`,
`vidora.list_learnings`. Every tool response includes a `provenance` block
(real | estimate | ai_analysis | fixture).

## Notification types

`render.completed | render.failed | publish.approved | publish.published |
publish.failed | approval.requested | budget.alert | quota.warning |
experiment.concluded`. Use the existing `notifications` table + server writer.

## File ownership (avoid merge collisions)

- Stream A (publish): `src/lib/publish/**`, `src/lib/youtube-publish.server.ts`,
  `src/lib/meta-publish.server.ts`, `src/lib/publishing-gates.server.ts`,
  routes `publish*`, `calendar*`, `review*`.
- Stream B (analytics): `src/lib/analytics/**` (extend; do NOT rewrite
  `analytics.ts`/`analytics.functions.ts` in place — add new modules),
  routes `analytics*`.
- Stream C (experiments/learnings): `src/lib/experiments/**`,
  `src/lib/learnings/**`, routes `experiments*`, `learnings*`.
- Stream D (comments/notify): `src/lib/comments/**`, `src/lib/notifications.*`
  (extend existing), routes `comments*`.
- Stream E (platform): `src/lib/api-keys/**`, `src/lib/mcp/**`,
  routes `agency*`, `settings/api*`. May read but NOT rewrite other streams'
  files.

Migrations: `supabase/migrations/2026092804<a-e>000_p4_<name>.sql`,
forward-only `IF NOT EXISTS`, RLS on every new table, no destructive ops.

## Decision numbering

Phase 3 ended at D135. Phase 4 decisions start at **D136**.
