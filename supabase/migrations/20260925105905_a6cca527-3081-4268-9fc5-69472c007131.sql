ALTER TABLE public.video_ideas ADD COLUMN IF NOT EXISTS safety_flag TEXT;
ALTER TABLE public.research_projects ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();