-- Video jobs: persist the chosen output aspect ratio so the visuals stage
-- can compose scene stills in the right orientation (16:9 / 9:16 / 1:1)
-- instead of always assuming widescreen.
ALTER TABLE public.video_jobs
  ADD COLUMN IF NOT EXISTS aspect_ratio TEXT NOT NULL DEFAULT '16:9'
    CONSTRAINT video_jobs_aspect_ratio_check
    CHECK (aspect_ratio IN ('16:9', '9:16', '1:1'));
