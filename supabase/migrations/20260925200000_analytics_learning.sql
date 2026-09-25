-- P8: Analytics & learning loop tables.
--
-- video_analytics: per-video metric snapshots (24h / 7d post-publish cadence).
--   One row per (youtube_video_id, snapshot_date) — deduped by UNIQUE.
-- channel_stats: daily channel-level snapshot per user.
-- learning_insights: derived insights feeding back into P3 (outliers, patterns,
--   idea boosts) and P6 (safety validation). All owner-scoped.

CREATE TABLE IF NOT EXISTS public.video_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  publish_job_id UUID REFERENCES public.publish_jobs(id) ON DELETE SET NULL,
  youtube_video_id TEXT NOT NULL,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  snapshot_date DATE NOT NULL DEFAULT (now()::date),
  age_days INTEGER NOT NULL DEFAULT 0,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (youtube_video_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS video_analytics_user_idx ON public.video_analytics (user_id);
CREATE INDEX IF NOT EXISTS video_analytics_video_idx ON public.video_analytics (youtube_video_id);

CREATE TABLE IF NOT EXISTS public.channel_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  snapshot_date DATE NOT NULL DEFAULT (now()::date),
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS channel_stats_user_idx ON public.channel_stats (user_id);

CREATE TABLE IF NOT EXISTS public.learning_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN (
    'own_outlier',        -- own video outperformed channel median -> P3 outlier
    'pattern',            -- hook/title/style correlated with CTR (correlation, not causation)
    'idea_boost',         -- pattern weight applied to P3 idea generation
    'safety_validation'   -- actual monetization status vs P6 score
  )),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS learning_insights_user_idx ON public.learning_insights (user_id);
CREATE INDEX IF NOT EXISTS learning_insights_kind_idx ON public.learning_insights (user_id, kind);

ALTER TABLE public.video_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS video_analytics_owner ON public.video_analytics;
CREATE POLICY video_analytics_owner ON public.video_analytics
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS channel_stats_owner ON public.channel_stats;
CREATE POLICY channel_stats_owner ON public.channel_stats
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS learning_insights_owner ON public.learning_insights;
CREATE POLICY learning_insights_owner ON public.learning_insights
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- updated_at touch triggers
DROP TRIGGER IF EXISTS video_analytics_touch ON public.video_analytics;
DROP TRIGGER IF EXISTS channel_stats_touch ON public.channel_stats;
