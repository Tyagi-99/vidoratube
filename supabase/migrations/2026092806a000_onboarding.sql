-- Phase 6 Stream B — onboarding wizard progress.
--
-- onboarding_progress: one row per user tracking the /onboarding wizard.
--   current_step: welcome|connect|creator-type|niche|goal|brand|scan|idea|video
--   answers:      free-form answers collected by the wizard (creator_type,
--                 niche, goal, channel_name, tone, first_idea, ...), merged
--                 server-side so partial progress survives tab closes.
--   completed:    true once the user finishes or explicitly skips the flow.
--
-- Forward-only, non-destructive, IF NOT EXISTS throughout. DO NOT APPLY
-- LIVE from here — apply via the Lovable dashboard SQL editor (Cloud >
-- Database), in filename order, then verify via information_schema.
-- (Per AGENTS.md: Lovable does not auto-apply supabase/migrations/*.sql.)

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.onboarding_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,
  current_step text NOT NULL DEFAULT 'welcome'
    CHECK (current_step IN (
      'welcome', 'connect', 'creator-type', 'niche', 'goal', 'brand',
      'scan', 'idea', 'video'
    )),
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS onboarding_progress_user_id_idx
  ON public.onboarding_progress (user_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger (reuses the existing public.touch_updated_at())
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'onboarding_progress_touch_updated_at'
  ) THEN
    CREATE TRIGGER onboarding_progress_touch_updated_at
      BEFORE UPDATE ON public.onboarding_progress
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- RLS: owner-only (same pattern as 20260928050000_p5_agent.sql)
-- ---------------------------------------------------------------------------

ALTER TABLE public.onboarding_progress ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'onboarding_progress'
      AND policyname = 'onboarding_progress_owner_all'
  ) THEN
    CREATE POLICY onboarding_progress_owner_all
      ON public.onboarding_progress
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Service-role bypass is intentional: the onboarding server functions run
-- with the user's own session client (context.supabase), so RLS is the
-- enforcement boundary and no code-level ownership check is needed.
-- ---------------------------------------------------------------------------
