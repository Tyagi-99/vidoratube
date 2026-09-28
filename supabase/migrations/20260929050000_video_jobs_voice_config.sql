-- Voice Intelligence: persist the user's full voice selection on the job
-- so the TTS stage can honor language + character + model + settings
-- (D328). The legacy `voice` nickname column is untouched for backward
-- compatibility with older workers.
ALTER TABLE public.video_jobs
  ADD COLUMN IF NOT EXISTS voice_config JSONB;
