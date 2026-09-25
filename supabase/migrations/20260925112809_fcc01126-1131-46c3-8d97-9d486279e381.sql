UPDATE public.projects SET music_volume = 0.15 WHERE music_volume IS NULL;
UPDATE public.projects SET music_ducking = true WHERE music_ducking IS NULL;
ALTER TABLE public.projects ALTER COLUMN music_volume SET DEFAULT 0.15, ALTER COLUMN music_volume SET NOT NULL,
  ALTER COLUMN music_ducking SET DEFAULT true, ALTER COLUMN music_ducking SET NOT NULL;

ALTER TABLE public.asset_provenance
  ALTER COLUMN provider SET DEFAULT 'unknown', ALTER COLUMN provider SET NOT NULL,
  ALTER COLUMN license SET DEFAULT 'unknown', ALTER COLUMN license SET NOT NULL;

ALTER TABLE public.subscriptions
  ALTER COLUMN provider SET NOT NULL, ALTER COLUMN external_id SET NOT NULL;

ALTER TABLE public.thumbnails
  ALTER COLUMN project_id SET NOT NULL, ALTER COLUMN url SET NOT NULL;

ALTER TABLE public.safety_scores
  ALTER COLUMN project_id SET NOT NULL,
  ALTER COLUMN score SET DEFAULT 0, ALTER COLUMN score SET NOT NULL,
  ALTER COLUMN band SET DEFAULT 'unknown', ALTER COLUMN band SET NOT NULL;

ALTER TABLE public.publish_jobs
  ALTER COLUMN project_id SET NOT NULL,
  ALTER COLUMN tags SET DEFAULT '{}', ALTER COLUMN tags SET NOT NULL;

ALTER TABLE public.plans
  ALTER COLUMN slug SET NOT NULL, ALTER COLUMN name SET NOT NULL,
  ALTER COLUMN credits_granted SET DEFAULT 0, ALTER COLUMN credits_granted SET NOT NULL;

ALTER TABLE public.outlier_videos
  ALTER COLUMN outlier_score SET DEFAULT 0, ALTER COLUMN outlier_score SET NOT NULL;

ALTER TABLE public.video_ideas
  ALTER COLUMN safety_flag SET DEFAULT 'safe', ALTER COLUMN safety_flag SET NOT NULL;

ALTER TABLE public.research_projects
  ALTER COLUMN niches DROP DEFAULT,
  ALTER COLUMN niches TYPE jsonb USING to_jsonb(niches),
  ALTER COLUMN niches SET DEFAULT '[]'::jsonb;