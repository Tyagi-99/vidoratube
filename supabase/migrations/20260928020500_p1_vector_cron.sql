-- Phase 1 (Foundation) — pgvector embeddings + pg_cron scheduling.
--
-- 1) pgvector: enables the vector-intelligence plans (similar channels/videos,
--    research retrieval, idea similarity). The `vector` extension ships with
--    Supabase Postgres; CREATE EXTENSION IF NOT EXISTS is safe to re-run.
--
-- 2) pg_cron: gives `requeue_stale_renders()` the DB-level scheduler it lacked
--    (DATABASE_ARCHITECTURE.md gap #2 — today it depends on server/worker
--    invocation). Signature verified in 20260925210000_requeue_stale_renders.sql:
--      public.requeue_stale_renders(p_lease_seconds integer DEFAULT 300)
--    so the zero-argument call below is valid and uses the 300s lease that
--    matches STALE thresholds / queue-depth predicates (D15/D18).
--
-- CAVEATS (flagged for the apply-and-verify checklist; see report):
--   a) pg_cron must be enabled for the project (Supabase dashboard →
--      Database → Extensions, or `create extension` as below). If the
--      platform refuses the extension, the schedule block fails WITHOUT
--      touching data — requeue stays server/worker-invoked as today.
--   b) The schedule runs as the role that applies this migration (the
--      dashboard SQL editor role, normally postgres). That role bypasses RLS
--      and owns the function, so EXECUTE is granted; no policy change needed.
--      If applied by a lesser role, verify `select * from cron.job`.
--   c) Job-name guard: the DO block unschedules a previous
--      'requeue-stale-renders' job first, so re-applying this migration
--      never creates duplicate schedules.

-- ── 1) pgvector ──────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "vector";

-- embedding dimension matches Gemini text-embedding-004 via the gateway;
-- adjustable: changing it later requires re-embedding all rows.
ALTER TABLE public.research_sources
  ADD COLUMN IF NOT EXISTS embedding vector(768);
ALTER TABLE public.videos
  ADD COLUMN IF NOT EXISTS embedding vector(768);
ALTER TABLE public.video_ideas
  ADD COLUMN IF NOT EXISTS embedding vector(768);

COMMENT ON COLUMN public.research_sources.embedding IS
  'Phase 1: 768-dim embedding (Gemini text-embedding-004 via the gateway; adjustable) for research retrieval / claim matching.';
COMMENT ON COLUMN public.videos.embedding IS
  'Phase 1: 768-dim embedding (Gemini text-embedding-004 via the gateway; adjustable) for similar-video search.';
COMMENT ON COLUMN public.video_ideas.embedding IS
  'Phase 1: 768-dim embedding (Gemini text-embedding-004 via the gateway; adjustable) for idea similarity / dedup.';

-- Cosine-similarity indexes (ivfflat; lists tuned for early scale — raise
-- with row counts; run ANALYZE after bulk backfills).
CREATE INDEX IF NOT EXISTS research_sources_embedding_idx
  ON public.research_sources USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS videos_embedding_idx
  ON public.videos USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS video_ideas_embedding_idx
  ON public.video_ideas USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ── 2) pg_cron: own the requeue_stale_renders schedule ────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  -- Idempotency guard: never stack duplicate schedules on re-apply.
  -- (Direct DELETE on cron.job avoids depending on the unschedule()
  -- overload set of the installed pg_cron version.)
  DELETE FROM cron.job WHERE jobname = 'requeue-stale-renders';
END $$;

-- Every 5 minutes: requeue render claims whose worker died or whose lease
-- (claimed_at older than p_lease_seconds=300 default) expired.
SELECT cron.schedule(
  'requeue-stale-renders',
  '*/5 * * * *',
  $$SELECT public.requeue_stale_renders()$$
);
