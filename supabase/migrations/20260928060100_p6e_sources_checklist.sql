-- Phase 6 Stream E (P5 multi-source ingestion, SF-1; P6 packaging checklist, AT-10).
--
-- 1) projects source columns: a project can now start from a pasted
--    transcript, article text, a reference URL, or the existing topic/draft
--    entry. The source is stored verbatim; Vidora parses it into its own
--    scene plan (it never re-publishes the source text as-is).
--    URL is a *reference only* — no server-side fetching (SSRF/abuse surface);
--    users paste the content they want Vidora to work from.
--
-- 2) checklist_dismissals: per-rule dismissals with a required reason for the
--    pre-publish packaging checklist (advisory only — dismissing never gates
--    publish). A dismissal carries into every future checklist run for the
--    matching rule (and, when channel-scoped, that channel), per the
--    dismiss-with-reason pattern. Rules are pinned in
--    src/lib/publish/checklist.ts (CHECKLIST_VERSION); a rule revision
--    re-arms dismissed entries for that rule id.
--
-- Forward-only, non-destructive, IF NOT EXISTS throughout. DO NOT APPLY
-- LIVE from here — apply via the Lovable dashboard SQL editor (Cloud >
-- Database), in filename order, then verify via information_schema.
-- (Per AGENTS.md: Lovable does not auto-apply supabase/migrations/*.sql.)

-- ---------------------------------------------------------------------------
-- 1) projects: source provenance columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'topic'
    CHECK (source_kind IN ('topic', 'draft', 'transcript', 'article', 'url'));

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS source_text text NULL;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS source_url text NULL;

-- ---------------------------------------------------------------------------
-- 2) checklist_dismissals
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.checklist_dismissals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  -- Pinned rule id from src/lib/publish/checklist.ts (e.g. 'tags_count').
  rule_id text NOT NULL CHECK (char_length(rule_id) BETWEEN 1 AND 80),
  -- Checklist version at dismissal time; a rule revision re-arms the entry.
  checklist_version integer NOT NULL,
  -- Optional channel scope: NULL = applies to every project.
  channel_id uuid NULL REFERENCES public.channels (id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS checklist_dismissals_unique_scope
  ON public.checklist_dismissals (user_id, rule_id, checklist_version, channel_id)
  WHERE channel_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS checklist_dismissals_unique_global
  ON public.checklist_dismissals (user_id, rule_id, checklist_version)
  WHERE channel_id IS NULL;

CREATE INDEX IF NOT EXISTS checklist_dismissals_user_idx
  ON public.checklist_dismissals (user_id, created_at DESC);

ALTER TABLE public.checklist_dismissals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'checklist_dismissals'
      AND policyname = 'checklist_dismissals_owner_all'
  ) THEN
    CREATE POLICY checklist_dismissals_owner_all
      ON public.checklist_dismissals
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
