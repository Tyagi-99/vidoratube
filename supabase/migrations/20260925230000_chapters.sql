-- Sprint 3-4 (item 4): 20-minute chapter/segment rendering.
--
-- A long-form render is no longer one monolith: the script is split into
-- 4-8 chapters (app-side, deterministic), each chapter renders as its own
-- MP4 on the worker, and the finished chapters are concatenated into the
-- final video. This migration adds the two tables that make that possible:
--
--   render_chapters  One row per chapter of a chapter-mode parent render.
--                    Carries its own status/attempts/claim lease so the
--                    worker can render chapters in parallel, retry a single
--                    chapter, and resume after a crash from the last finished
--                    chapter. Output MP4s live in storage; `output_path` is
--                    the storage path (validity = downloadable).
--   tts_cache        Paragraph-level narration cache keyed by
--                    (provider, voice_id, language_code, paragraph_hash).
--                    Re-renders and chapter-only re-renders reuse unchanged
--                    paragraphs instead of re-synthesizing identical text.
--
-- Non-destructive: two new tables, one new RPC, new indexes/policies only.
-- No existing tables, rows, functions, or policies are touched.
-- Apply via Supabase SQL editor or `supabase db push`.

-- ── render_chapters ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.render_chapters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  render_id uuid NOT NULL REFERENCES public.renders(id) ON DELETE CASCADE,
  chapter_index integer NOT NULL,
  title text NOT NULL DEFAULT '',
  script_text text NOT NULL DEFAULT '',
  -- [{ text, audio_path, duration_seconds }]: narration paragraphs with
  -- their cached TTS audio (storage paths into tts_cache-managed files).
  paragraphs jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- queued | rendering | done | failed
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  claimed_at timestamptz,
  claimed_by text,
  started_at timestamptz,
  finished_at timestamptz,
  -- Storage path of the finished chapter MP4
  -- ({user_id}/renders/{render_id}/chapters/{index}.mp4).
  output_path text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT render_chapters_status_check
    CHECK (status IN ('queued', 'rendering', 'done', 'failed'))
);

-- One chapter index per parent render; also the worker's read order.
CREATE UNIQUE INDEX IF NOT EXISTS render_chapters_render_index_uidx
  ON public.render_chapters (render_id, chapter_index);

-- Partial index for the stale-chapter requeue scan.
CREATE INDEX IF NOT EXISTS render_chapters_stale_idx
  ON public.render_chapters (claimed_at)
  WHERE status = 'rendering';

-- ── tts_cache ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tts_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  voice_id text NOT NULL,
  language_code text NOT NULL,
  -- sha256 hex of the normalized paragraph text (trimmed, whitespace
  -- collapsed). Normalization is language-neutral: it never alters the
  -- visible characters, only surrounding/interior whitespace runs.
  paragraph_hash text NOT NULL,
  -- Storage path of the synthesized audio (tts-cache/{provider}/
  -- {voice_id}/{language_code}/{hash}.mp3).
  audio_path text NOT NULL,
  duration_seconds numeric,
  byte_size integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tts_cache_lookup_unique
    UNIQUE (provider, voice_id, language_code, paragraph_hash)
);

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.render_chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tts_cache ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.render_chapters TO authenticated;
GRANT ALL ON public.render_chapters TO service_role;
-- tts_cache is worker/app-server only (mirrors worker_heartbeats): no
-- client policies, service_role only.
GRANT ALL ON public.tts_cache TO service_role;

-- Owner-scoped like renders: a user sees chapters only for renders they own.
DROP POLICY IF EXISTS "Users manage chapters of their own renders" ON public.render_chapters;
CREATE POLICY "Users manage chapters of their own renders"
ON public.render_chapters FOR ALL TO authenticated
USING (
  render_id IN (SELECT id FROM public.renders WHERE user_id = auth.uid())
)
WITH CHECK (
  render_id IN (SELECT id FROM public.renders WHERE user_id = auth.uid())
);

DROP POLICY IF EXISTS "Admins read all render chapters" ON public.render_chapters;
CREATE POLICY "Admins read all render chapters"
ON public.render_chapters FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Keep updated_at fresh (reuses the generic renders touch function; the
-- trigger runs as the table owner, not the caller).
DROP TRIGGER IF EXISTS update_render_chapters_updated_at ON public.render_chapters;
CREATE TRIGGER update_render_chapters_updated_at
BEFORE UPDATE ON public.render_chapters
FOR EACH ROW EXECUTE FUNCTION public.touch_renders_updated_at();

-- ── requeue_stale_chapters ────────────────────────────────────────────────
-- Chapter-level mirror of requeue_stale_renders: chapters stuck in
-- 'rendering' past the lease (crashed worker) go back to 'queued' with the
-- attempt counter bumped; chapters whose retry budget is exhausted are
-- marked 'failed' (terminal) instead of being requeued forever.
-- 'done' chapters are never touched: their output_path is the resume
-- checkpoint.
CREATE OR REPLACE FUNCTION public.requeue_stale_chapters(p_lease_seconds integer DEFAULT 300)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requeued integer := 0;
BEGIN
  UPDATE public.render_chapters
  SET status = 'failed',
      error = 'Worker died; retries exhausted',
      claimed_at = NULL,
      claimed_by = NULL
  WHERE status = 'rendering'
    AND (claimed_at IS NULL OR claimed_at < now() - make_interval(secs => p_lease_seconds))
    AND attempts >= max_attempts;

  UPDATE public.render_chapters
  SET status = 'queued',
      attempts = attempts + 1,
      claimed_at = NULL,
      claimed_by = NULL
  WHERE status = 'rendering'
    AND (claimed_at IS NULL OR claimed_at < now() - make_interval(secs => p_lease_seconds))
    AND attempts < max_attempts;
  GET DIAGNOSTICS v_requeued = ROW_COUNT;

  RETURN v_requeued;
END;
$$;

REVOKE ALL ON FUNCTION public.requeue_stale_chapters(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.requeue_stale_chapters(integer) TO service_role;
