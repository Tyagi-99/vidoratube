
CREATE TABLE IF NOT EXISTS public.renders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  job_id uuid,
  type text NOT NULL DEFAULT 'mp4',
  engine text NOT NULL DEFAULT 'browser_ffmpeg',
  status text NOT NULL DEFAULT 'queued',
  stage text NOT NULL DEFAULT 'queued',
  progress integer NOT NULL DEFAULT 0,
  format text NOT NULL DEFAULT 'mp4',
  resolution text,
  aspect_ratio text,
  duration numeric,
  file_url text,
  file_size bigint,
  error text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  render_started_at timestamptz,
  render_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS renders_project_idx ON public.renders(project_id);
CREATE INDEX IF NOT EXISTS renders_user_idx ON public.renders(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.renders TO authenticated;
GRANT ALL ON public.renders TO service_role;

ALTER TABLE public.renders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own renders" ON public.renders;
CREATE POLICY "Users manage their own renders"
ON public.renders FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.touch_renders_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.touch_renders_updated_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS update_renders_updated_at ON public.renders;
CREATE TRIGGER update_renders_updated_at
BEFORE UPDATE ON public.renders
FOR EACH ROW EXECUTE FUNCTION public.touch_renders_updated_at();

DROP POLICY IF EXISTS "Users update own generated videos" ON storage.objects;
CREATE POLICY "Users update own generated videos"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'generated-videos' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'generated-videos' AND (storage.foldername(name))[1] = auth.uid()::text);
