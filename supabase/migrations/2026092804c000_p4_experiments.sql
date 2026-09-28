-- 2026092804c000_p4_experiments.sql
-- Phase 4 Stream C (F34 Packaging Experiments + F35 Learning Engine).
--
-- Forward-only, non-destructive: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF
-- NOT EXISTS / DROP POLICY IF EXISTS only. No data is ever dropped.
--
-- The Phase 1 schema (20260928020200, 20260928020400, schema reconciliation)
-- already provides experiments / experiment_arms / learning_insights /
-- engagement_insights with owner RLS. This migration adds ONLY what is
-- genuinely missing for the pinned Phase 4 contracts:
--   * per-experiment gate config (min sample size, min duration) — pinned
--     stats discipline: min 100 impressions/arm (never lower without a
--     D-decision) and 24h minimum before ANY conclusion;
--   * learning_insights.topic (pattern mining groups by topic);
--   * learning_insights.source (human | ai_analysis | system) so AI-mined
--     learnings are always labeled "AI analysis" per the learning evidence
--     gate.
-- Conclusion shape { winner_arm_id, p_value, method, decided_at,
-- decided_by } lives in experiments.conclusion (jsonb); evidence shape lives
-- in learning_insights.evidence (jsonb). No new tables.

-- ── experiments: gate config ─────────────────────────────────────────────
ALTER TABLE public.experiments
  ADD COLUMN IF NOT EXISTS min_sample_size integer NOT NULL DEFAULT 100;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'experiments_min_sample_size_check'
      AND conrelid = 'public.experiments'::regclass
  ) THEN
    ALTER TABLE public.experiments
      ADD CONSTRAINT experiments_min_sample_size_check
      CHECK (min_sample_size >= 100);
  END IF;
END $$;

ALTER TABLE public.experiments
  ADD COLUMN IF NOT EXISTS min_duration_hours integer NOT NULL DEFAULT 24;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'experiments_min_duration_hours_check'
      AND conrelid = 'public.experiments'::regclass
  ) THEN
    ALTER TABLE public.experiments
      ADD CONSTRAINT experiments_min_duration_hours_check
      CHECK (min_duration_hours >= 1);
  END IF;
END $$;

COMMENT ON COLUMN public.experiments.min_sample_size IS
  'F34: minimum sample per arm before any conclusion (impressions for CTR, n for continuous metrics). Pinned floor 100 — never lower without a D-decision.';
COMMENT ON COLUMN public.experiments.min_duration_hours IS
  'F34: minimum wall-clock hours since started_at before any conclusion (default 24). Pause (status back to draft) does not rewind this clock.';

-- ── learning_insights: topic + source labels ─────────────────────────────
ALTER TABLE public.learning_insights
  ADD COLUMN IF NOT EXISTS topic text NOT NULL DEFAULT 'general';

ALTER TABLE public.learning_insights
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'human';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'learning_insights_source_check'
      AND conrelid = 'public.learning_insights'::regclass
  ) THEN
    ALTER TABLE public.learning_insights
      ADD CONSTRAINT learning_insights_source_check
      CHECK (source IN ('human', 'ai_analysis', 'system'));
  END IF;
END $$;

COMMENT ON COLUMN public.learning_insights.topic IS
  'F35: what the learning is about (title | thumbnail | packaging | hook | audience | general). Pattern mining groups validated learnings by topic.';
COMMENT ON COLUMN public.learning_insights.source IS
  'F35: human | ai_analysis | system. AI-mined pattern briefs are always ai_analysis and must render with an "AI analysis" label.';

CREATE INDEX IF NOT EXISTS learning_insights_status_idx
  ON public.learning_insights (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS learning_insights_topic_idx
  ON public.learning_insights (user_id, topic, status);

-- ── RLS re-assertion (policies already created in Phase 1; kept idempotent)
ALTER TABLE public.experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiment_arms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS experiments_owner ON public.experiments;
CREATE POLICY experiments_owner ON public.experiments
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS experiment_arms_owner ON public.experiment_arms;
CREATE POLICY experiment_arms_owner ON public.experiment_arms
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.experiments e
            WHERE e.id = experiment_arms.experiment_id AND e.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.experiments e
            WHERE e.id = experiment_arms.experiment_id AND e.user_id = auth.uid())
  );

DROP POLICY IF EXISTS learning_insights_owner ON public.learning_insights;
CREATE POLICY learning_insights_owner ON public.learning_insights
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
