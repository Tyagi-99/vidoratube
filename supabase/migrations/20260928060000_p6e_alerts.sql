-- Phase 6 Stream E (P1 Watchtower alerts, AG-5) — competitor-watch alert rules.
--
-- alert_rules: user-defined rules that watch tracked channels (or one channel /
-- one smart folder) and fire when:
--   - breakout_video: a video's outlier score (latest views / channel median)
--     meets or exceeds a threshold within a lookback window;
--   - title_pattern: a recently published video title matches a user regex;
--   - growth_condition: a channel's latest snapshot satisfies compound
--     conditions (e.g. subscriber_count >= X AND avg_views >= Y).
--
-- Firing is done by `checkAlertRules` in src/lib/intelligence/alerts.functions.ts:
-- it inserts a `notifications` row (type 'intel.alert', dedup key
-- alert:<ruleId>:<videoId|channelId>) and creates a draft `video_ideas` row so
-- the alert lands directly in the ideation backlog (Algrow's AG-5 pattern,
-- reimplemented in Vidora's own workflow).
--
-- Forward-only, non-destructive, IF NOT EXISTS throughout. DO NOT APPLY
-- LIVE from here — apply via the Lovable dashboard SQL editor (Cloud >
-- Database), in filename order, then verify via information_schema.
-- (Per AGENTS.md: Lovable does not auto-apply supabase/migrations/*.sql.)

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.alert_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  rule_type text NOT NULL
    CHECK (rule_type IN ('breakout_video', 'title_pattern', 'growth_condition')),
  -- Scope: exactly one of channel_id / folder_id set, or both NULL = every
  -- tracked channel the user owns.
  channel_id uuid NULL REFERENCES public.channels (id) ON DELETE CASCADE,
  folder_id uuid NULL REFERENCES public.folders (id) ON DELETE CASCADE,
  -- conditions jsonb, validated server-side (see alerts.ts ALERT_CONDITION_SCHEMAS):
  --   breakout_video:  { minOutlier: number, lookbackDays: number }
  --   title_pattern:   { pattern: string (regex), lookbackDays: number }
  --   growth_condition:{ minSubscribers: number|null, minAvgViews: number|null }
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  last_fired_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alert_rules_scope_check CHECK (
    (channel_id IS NULL AND folder_id IS NULL) OR
    (channel_id IS NOT NULL AND folder_id IS NULL) OR
    (channel_id IS NULL AND folder_id IS NOT NULL)
  )
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS alert_rules_user_active_idx
  ON public.alert_rules (user_id, is_active, updated_at DESC);

-- ---------------------------------------------------------------------------
-- updated_at trigger (reuses the existing public.touch_updated_at())
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'alert_rules_touch_updated_at'
  ) THEN
    CREATE TRIGGER alert_rules_touch_updated_at
      BEFORE UPDATE ON public.alert_rules
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- RLS: owner-only (same pattern as agent_conversations, p5 migration)
-- ---------------------------------------------------------------------------

ALTER TABLE public.alert_rules ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'alert_rules'
      AND policyname = 'alert_rules_owner_all'
  ) THEN
    CREATE POLICY alert_rules_owner_all
      ON public.alert_rules
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
