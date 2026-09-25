-- P3: Research / Idea Engine tables.
--
-- Top-of-funnel: niche discovery -> outlier analysis -> idea generation ->
-- script brief handoff. All tables are owner-scoped (user_id) with RLS.
--
-- Design:
-- - research_projects: one row per niche exploration. niches JSONB holds the
--   LLM-generated sub-niches, personas, pillars, monetization fit.
-- - outlier_videos: YouTube videos imported for a project, with computed
--   outlier_score (views vs channel median) and LLM-extracted patterns.
-- - video_ideas: generated ideas with lifecycle status
--   (new -> saved/dismissed -> used when handed off to a script project).
-- - youtube_api_cache: 24h cache for YouTube Data API lookups (video +
--   channel stats) so repeated imports don't burn quota. Keyed by a stable
--   cache key; service-role write, owner read via user_id.

CREATE TABLE IF NOT EXISTS public.research_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  topic text NOT NULL,
  language text NOT NULL DEFAULT 'English',
  niches jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.outlier_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.research_projects(id) ON DELETE CASCADE,
  youtube_id text NOT NULL,
  title text NOT NULL DEFAULT '',
  channel_id text NOT NULL DEFAULT '',
  channel_title text NOT NULL DEFAULT '',
  channel_subs bigint NOT NULL DEFAULT 0,
  view_count bigint NOT NULL DEFAULT 0,
  published_at timestamptz,
  outlier_score double precision NOT NULL DEFAULT 1.0,
  patterns jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, youtube_id)
);

CREATE TABLE IF NOT EXISTS public.video_ideas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.research_projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  hook text NOT NULL DEFAULT '',
  angle text NOT NULL DEFAULT '',
  format text NOT NULL DEFAULT 'long',
  difficulty text NOT NULL DEFAULT 'medium',
  safety_flag text NOT NULL DEFAULT 'safe',
  status text NOT NULL DEFAULT 'new',
  project_ref uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.youtube_api_cache (
  cache_key text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS research_projects_user_idx ON public.research_projects (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS outlier_videos_project_idx ON public.outlier_videos (project_id, outlier_score DESC);
CREATE INDEX IF NOT EXISTS video_ideas_project_idx ON public.video_ideas (project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS youtube_api_cache_expiry_idx ON public.youtube_api_cache (expires_at);

-- RLS
ALTER TABLE public.research_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outlier_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.youtube_api_cache ENABLE ROW LEVEL SECURITY;

-- research_projects: owner-only
CREATE POLICY research_projects_owner_select ON public.research_projects
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY research_projects_owner_insert ON public.research_projects
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY research_projects_owner_update ON public.research_projects
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY research_projects_owner_delete ON public.research_projects
  FOR DELETE USING (auth.uid() = user_id);

-- outlier_videos: owner-only
CREATE POLICY outlier_videos_owner_select ON public.outlier_videos
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY outlier_videos_owner_insert ON public.outlier_videos
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY outlier_videos_owner_update ON public.outlier_videos
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY outlier_videos_owner_delete ON public.outlier_videos
  FOR DELETE USING (auth.uid() = user_id);

-- video_ideas: owner-only
CREATE POLICY video_ideas_owner_select ON public.video_ideas
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY video_ideas_owner_insert ON public.video_ideas
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY video_ideas_owner_update ON public.video_ideas
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY video_ideas_owner_delete ON public.video_ideas
  FOR DELETE USING (auth.uid() = user_id);

-- youtube_api_cache: owner-only (server writes via service role, which bypasses RLS)
CREATE POLICY youtube_api_cache_owner_select ON public.youtube_api_cache
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY youtube_api_cache_owner_insert ON public.youtube_api_cache
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY youtube_api_cache_owner_delete ON public.youtube_api_cache
  FOR DELETE USING (auth.uid() = user_id);

-- updated_at maintenance
CREATE OR REPLACE FUNCTION public.touch_research_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_research_projects_touch ON public.research_projects;
CREATE TRIGGER trg_research_projects_touch
  BEFORE UPDATE ON public.research_projects
  FOR EACH ROW EXECUTE FUNCTION public.touch_research_updated_at();

DROP TRIGGER IF EXISTS trg_video_ideas_touch ON public.video_ideas;
CREATE TRIGGER trg_video_ideas_touch
  BEFORE UPDATE ON public.video_ideas
  FOR EACH ROW EXECUTE FUNCTION public.touch_research_updated_at();
