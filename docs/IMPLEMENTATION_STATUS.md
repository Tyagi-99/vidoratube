# Vidora OS — Implementation Status

Living document, updated from verified state only. Branch: `phase1/foundation`
(not pushed to origin; parent merges to main after verification).

## Phase 1 — Foundation

| Workstream | State | Evidence |
|---|---|---|
| 1. Workspace roles & audit | **SHIPPED** (code) | `src/lib/workspace-auth.server.ts` (6-role matrix, `requireWorkspaceRole` middleware), `src/lib/audit-log.server.ts` (`writeAuditLog`/`auditSafely`), `src/lib/admin-access.ts` (403 state), admin 403 panel replaces client redirect (S2). 34 new tests. Migration `20260928020600_p1_workspace_roles.sql` widens role CHECK + backfills viewer→client + widens `is_workspace_editor`. |
| 2. Database | **SHIPPED** (code; apply pending) | 7 migration files `20260928020000`–`20260928020600`: 32 new tables, pgvector + `vector(768)` embeddings, pg_cron schedule for `requeue_stale_renders`, RLS on all new tables, `rls-policies.test.ts` extended. NOT applied to production (manual step — KNOWN_ISSUES). |
| 3. Jobs durability | IN PROGRESS | Worker active on branch `wjobs`. |
| 4. Credits | **SHIPPED** (code) | `src/lib/credits/`: `estimates.server.ts` (ESTIMATE-labeled, pinned Studio-plan $0.245/credit reference, unknown prices → null not invented), `balance.server.ts`, `budgets.server.ts` (caps enforced against `generation_jobs.cost_actual_credits` month-to-date; null = uncapped), `usage.server.ts` (read-model over `credit_ledger`), `preflight.server.ts` (estimate→balance→budget). TTS voiceover stage gated: INSUFFICIENT_CREDITS/BUDGET_EXCEEDED instead of provider call. 46 new tests. |
| 5. Providers | **SHIPPED** (code) | `ProviderResult` envelope (model/taskId/latency/cost/status/error/usage, never throws), `withProviderTelemetry` wired into TTS + image paths → `api_usage`. Real: ElevenLabs Scribe transcription, YouTube Data API search. Honestly-unconfigured: web search shell (needs key), video gen without `FAL_API_KEY`. `generateVideoWithFallback`: ordered chain, one attempt per provider, no blind paid retries (fakes only in tests). 20 new tests. |

## Reconciliation decisions (DB)

- Extended, not duplicated: `video_ideas` (= plan's `ideas`), `learning_insights` (= plan's `learnings`).
- Documented-as-canonical via `COMMENT ON TABLE`: `publish_jobs` (= `publishing_jobs`), `thumbnails` (= `thumbnail_variants`), `content_assets` (= `assets`).
- Created: `channels`, `channel_snapshots`, `competitor_channels`, `videos`, `video_snapshots`, `research_sources`, `research_claims`, `folders`, `folder_rules`, `folder_items`, `scripts`, `script_versions`, `brand_profiles`, `voices`, `scene_versions`, `thumbnail_projects`, `title_variants`, `content_packages`, `generation_jobs`, `provider_tasks`, `experiments`, `experiment_arms`, `channel_connections`, `analytics_snapshots`, `retention_snapshots`, `comments`, `engagement_insights`, `audit_logs`, `workspace_budgets`, `project_budgets`, `api_keys`, `niche_snapshots`.
- `publish.approve` deliberately absent from the workspace permission matrix — the server-enforced `approvals` gate (D61/D62) is not weakened.

## What's next

Phase 2 — Intelligence (F1–F7): channel ingestion → Niche Finder → Blueprints → Explorer → Outliers → Video Intelligence → Trend Radar → Smart Folders. Blocked on: YouTube Data API quota for ingestion scale (founder: API project/quota).
