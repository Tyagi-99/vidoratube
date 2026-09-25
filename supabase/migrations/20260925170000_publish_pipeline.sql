-- P5: Thumbnail/SEO studio + YouTube publishing tables.
--
-- thumbnails: AI-generated thumbnail variants per project (16:9 + 9:16),
-- with text overlay specs and a selected variant for publishing.
-- seo_metadata: LLM-generated titles/descriptions/tags per project.
-- publish_jobs: human-approved YouTube publish pipeline with scheduling.
-- NO unattended auto-publishing: status can only reach 'approved' via an
-- explicit user action (enforced in server functions, not just UI).

CREATE TABLE IF NOT EXISTS public.thumbnails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  variant INTEGER NOT NULL DEFAULT 1 CHECK (variant BETWEEN 1 AND 3),
  aspect TEXT NOT NULL DEFAULT '16:9' CHECK (aspect IN ('16:9', '9:16')),
  url TEXT NOT NULL,
  -- final_url: overlay-burned version uploaded by the client (canvas).
  -- Falls back to url when no overlay was applied.
  final_url TEXT,
  text_overlay JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- text_overlay: { headline, font, color, position, fontSize }
  prompt TEXT,
  provider TEXT,
  model TEXT,
  license TEXT NOT NULL DEFAULT 'ai-generated',
  selected BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, variant, aspect)
);

CREATE TABLE IF NOT EXISTS public.seo_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  titles JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- titles: [{ title, score, scoreBreakdown: { length, keyword, curiosity, clarity } }]
  selected_title TEXT,
  description TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  hashtags TEXT[] NOT NULL DEFAULT '{}',
  chapters JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id)
);

-- Publish pipeline state machine:
-- draft -> approved -> scheduled -> uploading -> published
--                    -> failed (from scheduled/uploading)
-- draft -> canceled
-- Only 'approved' requires explicit human action. Nothing auto-advances
-- beyond draft without it.
CREATE TABLE IF NOT EXISTS public.publish_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  video_job_id UUID REFERENCES public.video_jobs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'scheduled', 'uploading', 'published', 'failed', 'canceled')),
  thumbnail_id UUID REFERENCES public.thumbnails(id) ON DELETE SET NULL,
  title TEXT,
  description TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  privacy TEXT NOT NULL DEFAULT 'private' CHECK (privacy IN ('private', 'unlisted', 'public')),
  made_for_kids BOOLEAN,
  scheduled_for TIMESTAMPTZ,
  youtube_video_id TEXT,
  youtube_url TEXT,
  error TEXT,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS thumbnails_project_idx ON public.thumbnails (project_id);
CREATE INDEX IF NOT EXISTS seo_metadata_project_idx ON public.seo_metadata (project_id);
CREATE INDEX IF NOT EXISTS publish_jobs_user_idx ON public.publish_jobs (user_id);
CREATE INDEX IF NOT EXISTS publish_jobs_project_idx ON public.publish_jobs (project_id);
CREATE INDEX IF NOT EXISTS publish_jobs_scheduled_idx ON public.publish_jobs (scheduled_for)
  WHERE status = 'scheduled';

-- RLS: owner-only everywhere
ALTER TABLE public.thumbnails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publish_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY thumbnails_owner ON public.thumbnails
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY seo_metadata_owner ON public.seo_metadata
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY publish_jobs_owner ON public.publish_jobs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- updated_at triggers
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS seo_metadata_touch ON public.seo_metadata;
CREATE TRIGGER seo_metadata_touch
  BEFORE UPDATE ON public.seo_metadata
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS publish_jobs_touch ON public.publish_jobs;
CREATE TRIGGER publish_jobs_touch
  BEFORE UPDATE ON public.publish_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
