-- Phase 3 Stream F (F23 quick create + F26 SEO studio).
-- Forward-only, IF NOT EXISTS, owner-scoped RLS.
-- NOTE: unapplied locally — Lovable Cloud SQL editor must apply this file.

-- ── quick_create_runs ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.quick_create_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  topic text NOT NULL,
  hook text NOT NULL DEFAULT '',
  facts jsonb NOT NULL DEFAULT '[]'::jsonb,
  spend_approved boolean NOT NULL DEFAULT false,
  stage_states jsonb NOT NULL DEFAULT '{}'::jsonb,
  artifacts jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quick_create_runs_user_idx
  ON public.quick_create_runs (user_id, created_at DESC);

ALTER TABLE public.quick_create_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quick_create_runs_own ON public.quick_create_runs;
CREATE POLICY quick_create_runs_own ON public.quick_create_runs
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.quick_create_runs TO authenticated;
GRANT ALL ON public.quick_create_runs TO service_role;

-- ── seo_packages ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.seo_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  chosen_title text NOT NULL,
  title_options jsonb NOT NULL DEFAULT '[]'::jsonb,
  description text NOT NULL DEFAULT '',
  hashtags text[] NOT NULL DEFAULT '{}'::text[],
  thumbnail_concepts jsonb NOT NULL DEFAULT '[]'::jsonb,
  exported_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS seo_packages_project_idx
  ON public.seo_packages (project_id, created_at DESC);

ALTER TABLE public.seo_packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS seo_packages_own ON public.seo_packages;
CREATE POLICY seo_packages_own ON public.seo_packages
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.seo_packages TO authenticated;
GRANT ALL ON public.seo_packages TO service_role;
