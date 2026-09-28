# Phase 4 — Complete Migration List (ordered)

**19 migration files** must be applied in filename order in Lovable's Cloud /
Database SQL editor, one file at a time, then verified via `information_schema`.
Lovable does NOT auto-apply migrations pushed to GitHub. All files are
forward-only, `IF NOT EXISTS`-style, non-destructive.

Status as of 2026-09-28 ~04:31 UTC: ALL 19 files APPLIED on the live database
in filename order via the Lovable Cloud SQL editor (each verified with
information_schema/pg_catalog read queries before proceeding).
Deviations recorded in docs/DECISIONS.md:
- D174: `video_ideas.score` corrected to jsonb (file 5) to match the code's
  `{ computed_at, score: IdeaScore }` cache payload.
- D175: file 6 applied as pgvector-only (extension + 3 embedding columns +
  3 ivfflat indexes); the pg_cron schedule is DEFERRED — the SQL editor role
  gets `permission denied for table cron.job`. Owner action: enable pg_cron
  in Lovable dashboard → Database → Extensions, then run
  `SELECT cron.schedule('requeue-stale-renders','*/5 * * * *',
   $$SELECT public.requeue_stale_renders()$$);`. Requeue stays
  server/worker-invoked as today until then.
- D176: file 12 hardened for the live `characters` shape (no `updated_at`,
  legacy `style` text instead of `style_notes`): adds both columns and
  preserves legacy `style` into `style_notes`.

Follow-up migration (pending apply): `2026092804f000_client_errors_hardening.sql`
— DB payload caps on the anonymous insert-only client_errors telemetry path
(remediates the pre-publish scan warning without removing anon telemetry).

## Phase 1 — Foundation (7 files)

1. `supabase/migrations/20260928020000_p1_intelligence.sql`
2. `supabase/migrations/20260928020100_p1_creation.sql`
3. `supabase/migrations/20260928020200_p1_operations.sql`
4. `supabase/migrations/20260928020300_p1_platform.sql`
5. `supabase/migrations/20260928020400_p1_extensions.sql`
6. `supabase/migrations/20260928020500_p1_vector_cron.sql`
7. `supabase/migrations/20260928020600_p1_workspace_roles.sql`

32 creator-OS tables + RLS, pgvector, pg_cron stale-render recovery,
workspace roles/audit, credit budgets.

## Phase 2 — Intelligence (2 files)

8. `supabase/migrations/20260928030000_p2_channel_niche.sql`
9. `supabase/migrations/20260928030100_p2_blueprint.sql`

Channel/niche/blueprint/outlier/trend/smart-folder tables.

## Phase 3 — Creation (5 files)

10. `supabase/migrations/20260928041000_p3_stream_a.sql` — `video_ideas.score` cache column (F8)
11. `supabase/migrations/20260928041100_p3_stream_b.sql` — F11 claim review states/strict mode, F12 script flags (columns only)
12. `supabase/migrations/20260928041200_p3_stream_c.sql` — `characters` F16 shape (keeps existing table when present, adds `style_notes`)
13. `supabase/migrations/20260928041300_p3_stream_d.sql` — `voices` owner lookup index (F17/F18)
14. `supabase/migrations/20260928041400_p3_stream_f.sql` — `quick_create_runs`, `seo_packages` (owner-scoped RLS)

## Phase 4 — Operations/Learning (5 files)

15. `supabase/migrations/2026092804a000_p4_publish.sql` — Stream A (F27/F28/F29):
    `publish_jobs.idempotency_key` (unique; backfills existing rows with
    `'job_' || id`, default `gen_random_uuid()`-based). Everything else Stream A
    needs already exists (`channel_connections`, `approvals`,
    `publish_warnings`, `audit_logs`, `api_usage`, `workspace_approvals`).
16. `supabase/migrations/2026092804b000_p4_analytics.sql` — Stream B (F30–F33, F37–F38):
    `analytics_snapshots.source` and `retention_snapshots.source` (NOT NULL,
    DEFAULT `'fixture'`, CHECK in `('youtube_analytics','meta_insights','fixture')`);
    new table `monetization_settings`.
17. `supabase/migrations/2026092804c000_p4_experiments.sql` — Stream C (F34/F35):
    no new tables; additive columns/constraints on `experiments`,
    `experiment_arms`, `learning_insights` (sample-size floors, 24h minimum,
    `conclusion`/`evidence` jsonb shapes).
18. `supabase/migrations/2026092804d000_p4_comments.sql` — Stream D (F36):
    `notifications.dedup_key` + partial UNIQUE index on
    `(user_id, dedup_key)`; partial index on `comments(is_question)` for the
    question feed.
19. `supabase/migrations/2026092804e000_p4_platform.sql` — Stream E (F41 + brand/invites):
    new tables `brand_assets`, `workspace_invites`; additive `last_used_at`
    column on `api_keys` (key_hash-only storage already exists).

## Verification after applying

```sql
SELECT tablename FROM pg_tables WHERE schemaname='public'
  AND tablename IN ('publish_jobs','analytics_snapshots','retention_snapshots',
    'monetization_settings','experiments','experiment_arms','learning_insights',
    'comments','notifications','api_keys','brand_assets','workspace_invites');
SELECT extname FROM pg_extension WHERE extname IN ('vector','pg_cron');
SELECT count(*) FROM cron.job;
```

Then reload `/status` and the relevant live routes.
