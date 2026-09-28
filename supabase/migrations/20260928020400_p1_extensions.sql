-- Phase 1 (Foundation) — Extensions of existing tables (D88: extend, don't migrate).
--
-- RECONCILIATION DECISIONS (evidence for each extend-vs-create call):
--
-- 1) plan `ideas` → EXTEND public.video_ideas (NOT a new table).
--    Evidence: video_ideas already carries the F8 idea record (title, hook,
--    angle, format, difficulty, safety_flag, status, project_ref) and D74's
--    deterministic recommendation engine scores over it. A parallel `ideas`
--    table would split the idea graph and orphan D74. Added below: score
--    breakdown, score (jsonb cache payload — MUST stay jsonb; the Phase 3
--    idea engine writes { computed_at, score: IdeaScore } via
--    buildScoreCachePayload in src/lib/creation/ideas/ideas.functions.ts),
--    outlier linkage, evidence payload, source.
--
-- 2) plan `learnings` → EXTEND public.learning_insights (NOT a new table).
--    Evidence: learning_insights already stores derived learnings
--    (kind, payload) with an owner policy. A parallel `learnings` table would
--    duplicate it. Added below: widened kind enum (experiment outcomes,
--    comment signals), evidence, confidence, experiment linkage, lifecycle
--    status — everything F35's evidence-gated learning engine needs.
--
-- 3) plan `publishing_jobs` → public.publish_jobs IS the canonical table.
--    Evidence: full publish pipeline state machine (draft → approved →
--    scheduled → uploading → published/failed/canceled) with project,
--    video_job, thumbnail, title/description/tags/privacy, scheduled_for,
--    platform result ids, and approval linkage via the approvals table (D61).
--    Adequate as-is; documented via COMMENT only. No new table, no columns.
--
-- 4) plan `thumbnail_variants` → public.thumbnails IS the canonical variant
--    store. Evidence: one row per (project_id, variant, aspect) with
--    url/final_url, text_overlay, prompt (+prompt_hash), provider/model,
--    license, is_ai_generated, selected. Adequate as-is; thumbnail_projects
--    (20260928020100) is the editor surface grouping them. COMMENT only.
--
-- 5) plan `assets` → public.content_assets IS the canonical asset store.
--    Evidence: kind/origin/rights_basis/storage_path/checksums/dimensions/
--    technical_metadata plus asset_provenance rows per licensing decision
--    (D49). F18's rights-tracking requirement is already modeled. COMMENT only.
--
-- 6) content_packages.idea_id → FK to public.video_ideas (canonical ideas
--    table per decision 1).
--
-- Forward-only, non-destructive: ADD COLUMN IF NOT EXISTS / guarded
-- constraint changes only. No data is dropped, renamed, or retyped.

-- ── 1) video_ideas: F8 evidence-backed scoring fields ─────────────────────
ALTER TABLE public.video_ideas
  ADD COLUMN IF NOT EXISTS score_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb;
-- NOTE (2026-09-28): `score` is jsonb, NOT numeric. The Phase 3 idea engine
-- (src/lib/creation/ideas/ideas.functions.ts) writes the cache payload
-- { computed_at, score: IdeaScore } via buildScoreCachePayload and reads it
-- back as an object. The Phase 3 migration 20260928041000_p3_stream_a.sql
-- declares the same jsonb shape; its ADD COLUMN IF NOT EXISTS is a no-op
-- once this file has run. A numeric score would break the scorer cache.
ALTER TABLE public.video_ideas
  ADD COLUMN IF NOT EXISTS score jsonb;
ALTER TABLE public.video_ideas
  ADD COLUMN IF NOT EXISTS outlier_video_id uuid
    REFERENCES public.outlier_videos(id) ON DELETE SET NULL;
ALTER TABLE public.video_ideas
  ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.video_ideas
  ADD COLUMN IF NOT EXISTS idea_source text NOT NULL DEFAULT 'manual'
    CHECK (idea_source IN ('manual', 'outlier', 'trend', 'agent'));

COMMENT ON TABLE public.video_ideas IS
  'CANONICAL ideas table for the Phase 1 plan (plan name: ideas) — extended 20260928020400 with score_breakdown/score, outlier_video_id, evidence, idea_source for the F8 evidence-backed engine. Deterministic recommendations (D74) score over this table.';
COMMENT ON COLUMN public.video_ideas.score_breakdown IS
  'Explainable scoring factors { topic_overlap, hook_overlap, outlier_evidence, safety, difficulty, ... } with machine-readable reasons (D74).';
COMMENT ON COLUMN public.video_ideas.evidence IS
  'Evidence payload: outlier_video_id refs, research_claim ids, trend signals — every score must cite evidence, never bare numbers.';

CREATE INDEX IF NOT EXISTS video_ideas_outlier_idx
  ON public.video_ideas (outlier_video_id) WHERE outlier_video_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS video_ideas_score_idx
  ON public.video_ideas (project_id, score DESC NULLS LAST);

-- ── 2) learning_insights: F35 evidence-gated learning fields ─────────────
-- Widen the kind enum (guarded: only if the old inline constraint exists).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'learning_insights_kind_check'
      AND conrelid = 'public.learning_insights'::regclass
  ) THEN
    ALTER TABLE public.learning_insights
      DROP CONSTRAINT learning_insights_kind_check;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'learning_insights_kind_check'
      AND conrelid = 'public.learning_insights'::regclass
  ) THEN
    ALTER TABLE public.learning_insights
      ADD CONSTRAINT learning_insights_kind_check CHECK (kind IN (
        'own_outlier',        -- own video outperformed channel median -> P3 outlier
        'pattern',            -- hook/title/style correlated with CTR (correlation, not causation)
        'idea_boost',         -- pattern weight applied to P3 idea generation
        'safety_validation',  -- actual monetization status vs P6 score
        'experiment_outcome', -- F35: validated/refuted packaging-experiment result
        'comment_signal'      -- F36: recurring audience request / question pattern
      ));
  END IF;
END $$;

ALTER TABLE public.learning_insights
  ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.learning_insights
  ADD COLUMN IF NOT EXISTS confidence numeric
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1));
ALTER TABLE public.learning_insights
  ADD COLUMN IF NOT EXISTS experiment_id uuid
    REFERENCES public.experiments(id) ON DELETE SET NULL;
ALTER TABLE public.learning_insights
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'validated', 'refuted', 'archived'));

COMMENT ON TABLE public.learning_insights IS
  'CANONICAL learnings store for the Phase 1 plan (plan name: learnings) — extended 20260928020400 with widened kind enum (experiment_outcome, comment_signal), evidence, confidence, experiment_id, status for the F35 evidence-gated learning engine.';
COMMENT ON COLUMN public.learning_insights.evidence IS
  'F35: the outcome data that earned this learning (experiment arm metrics, before/after deltas, sample sizes). A learning without evidence stays proposed.';

CREATE INDEX IF NOT EXISTS learning_insights_experiment_idx
  ON public.learning_insights (experiment_id) WHERE experiment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS learning_insights_status_idx
  ON public.learning_insights (user_id, status, created_at DESC);

-- ── 3/4/5) canonical-table mapping comments ───────────────────────────────
COMMENT ON TABLE public.publish_jobs IS
  'CANONICAL publishing-jobs table for the Phase 1 plan (plan name: publishing_jobs). Full publish pipeline state machine (draft → approved → scheduled → uploading → published/failed/canceled); approval enforced via the approvals table (D61/D68). Calendar (F28) reads scheduled_for.';

COMMENT ON TABLE public.thumbnails IS
  'CANONICAL thumbnail variant store for the Phase 1 plan (plan name: thumbnail_variants): one row per (project_id, variant, aspect) with prompt_hash + is_ai_generated provenance. thumbnail_projects is the layered-editor surface grouping these variant rows.';

COMMENT ON TABLE public.content_assets IS
  'CANONICAL asset store for the Phase 1 plan (plan name: assets). Rights tracked via rights_basis + per-decision asset_provenance rows (D49); licensed stock (F18) reuses this table.';

-- ── 6) content_packages.idea_id → canonical ideas table ──────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_packages_idea_fk') THEN
    ALTER TABLE public.content_packages
      ADD CONSTRAINT content_packages_idea_fk
      FOREIGN KEY (idea_id) REFERENCES public.video_ideas(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.content_packages.idea_id IS
  'References public.video_ideas — the canonical ideas table (plan name: ideas).';
