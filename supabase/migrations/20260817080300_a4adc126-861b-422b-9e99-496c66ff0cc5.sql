ALTER TABLE public.video_jobs
  ADD COLUMN IF NOT EXISTS audio_url TEXT,
  ADD COLUMN IF NOT EXISTS assets JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'planning',
  ADD COLUMN IF NOT EXISTS render_id TEXT,
  ADD COLUMN IF NOT EXISTS youtube_video_id TEXT,
  ADD COLUMN IF NOT EXISTS youtube_status TEXT;

CREATE TABLE IF NOT EXISTS public.youtube_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  channel_id TEXT,
  channel_title TEXT,
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  expires_at TIMESTAMPTZ,
  scope TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, DELETE ON public.youtube_connections TO authenticated;
GRANT ALL ON public.youtube_connections TO service_role;
ALTER TABLE public.youtube_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own youtube connection" ON public.youtube_connections;
CREATE POLICY "Users read own youtube connection"
  ON public.youtube_connections FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users disconnect own youtube" ON public.youtube_connections;
CREATE POLICY "Users disconnect own youtube"
  ON public.youtube_connections FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

REVOKE SELECT (refresh_token, access_token) ON public.youtube_connections FROM authenticated;

INSERT INTO public.integrations (provider, label, category, description, enabled, secret_name, settings, status)
VALUES
  ('shotstack', 'Shotstack (video render)', 'video', 'Composes the voiceover, footage and captions into a real MP4.', false, 'SHOTSTACK_API_KEY', '{"env":"stage","resolution":"hd"}'::jsonb, 'not_configured'),
  ('youtube', 'YouTube Data API', 'publishing', 'Lets users connect their channel and publish finished videos.', false, 'GOOGLE_OAUTH_CLIENT_SECRET', '{"scope":"https://www.googleapis.com/auth/youtube.upload"}'::jsonb, 'not_configured'),
  ('tts', 'AI voiceover', 'ai', 'Generates the narration audio track.', true, NULL, '{"model":"openai/gpt-4o-mini-tts"}'::jsonb, 'ready')
ON CONFLICT (provider) DO NOTHING;