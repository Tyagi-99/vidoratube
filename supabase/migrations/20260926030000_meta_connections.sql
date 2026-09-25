-- Sprint 7–8 (workstream A): Meta (Facebook/Instagram) publishing adapters.
--
-- meta_connections stores the founder-designated test account's Page access
-- token (AES-256-GCM encrypted, same envelope as youtube_connections) plus the
-- linked Instagram Business/Creator account. Tokens are written by the
-- server-side Meta OAuth callback only; the publish adapters refuse to run
-- unless the connected Page/IG account matches META_TEST_PAGE_ID /
-- META_TEST_IG_USER_ID (test-account gate in publishing-gates.server.ts).
--
-- publish_jobs gains nullable Meta result columns so a Meta publish records
-- where it landed without overloading the youtube_* columns.

CREATE TABLE IF NOT EXISTS public.meta_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  page_id TEXT NOT NULL,
  page_name TEXT,
  ig_user_id TEXT,
  ig_username TEXT,
  access_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  scope TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, DELETE ON public.meta_connections TO authenticated;
GRANT ALL ON public.meta_connections TO service_role;
ALTER TABLE public.meta_connections ENABLE ROW LEVEL SECURITY;

-- The raw token column is never readable by the client; only service_role
-- (server functions) may read it, and even then only decrypted in memory.
REVOKE SELECT (access_token) ON public.meta_connections FROM authenticated;

DROP POLICY IF EXISTS "Users read own meta connection" ON public.meta_connections;
CREATE POLICY "Users read own meta connection"
  ON public.meta_connections FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own meta connection" ON public.meta_connections;
CREATE POLICY "Users insert own meta connection"
  ON public.meta_connections FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own meta connection" ON public.meta_connections;
CREATE POLICY "Users update own meta connection"
  ON public.meta_connections FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users disconnect own meta" ON public.meta_connections;
CREATE POLICY "Users disconnect own meta"
  ON public.meta_connections FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Meta publish results on publish_jobs (nullable; YouTube flow untouched).
ALTER TABLE public.publish_jobs
  ADD COLUMN IF NOT EXISTS meta_fb_post_id TEXT,
  ADD COLUMN IF NOT EXISTS meta_ig_media_id TEXT,
  ADD COLUMN IF NOT EXISTS meta_ig_permalink TEXT;
