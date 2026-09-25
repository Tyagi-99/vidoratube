-- P8 follow-up: tag outlier_videos with a source so the learning loop can
-- distinguish imported competitor outliers from the user's own channel winners.

ALTER TABLE public.outlier_videos
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'import'
  CHECK (source IN ('import', 'own'));

CREATE INDEX IF NOT EXISTS outlier_videos_source_idx
  ON public.outlier_videos (user_id, source, outlier_score DESC);

-- P8: record when a video actually went live on YouTube so the analytics
-- scheduler can compute 24h / 7d snapshot windows.
ALTER TABLE public.publish_jobs
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
