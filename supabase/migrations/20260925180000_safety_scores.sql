-- P6: Monetization Safety Score.
--
-- safety_scores: versioned, explainable pre-publish monetization risk scores.
-- Every row stores the scorer version so historical scores stay interpretable
-- when the algorithm changes. Owner-only RLS.
--
-- publish_jobs gains two columns for the P6 safety gate:
--   safety_score    — latest score at approval time (null = never scored)
--   safety_override — true when the user explicitly acknowledged a <50 score
-- The server (not the UI) enforces: score < 50 requires safety_override = true.

CREATE TABLE IF NOT EXISTS public.safety_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  band TEXT NOT NULL CHECK (band IN ('safe', 'minor', 'at-risk', 'high-risk')),
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- dimensions: { advertiser: {points, maxPoints}, copyright: {...}, ... }
  issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- issues: [{ dimension, severity, message, suggestion, span }]
  ai_review JSONB,
  -- ai_review: { issues: [...], model, created_at } when deep review was run
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS safety_scores_project_idx
  ON public.safety_scores (project_id, created_at DESC);

ALTER TABLE public.safety_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY safety_scores_owner ON public.safety_scores
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Safety gate columns on the publish pipeline.
ALTER TABLE public.publish_jobs
  ADD COLUMN IF NOT EXISTS safety_score INTEGER CHECK (safety_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS safety_override BOOLEAN NOT NULL DEFAULT false;
