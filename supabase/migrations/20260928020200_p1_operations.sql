-- Phase 1 (Foundation) — Operations domain.
--
-- RECONCILIATION (D88: extend, don't migrate). All tables below were verified
-- MISSING from supabase/migrations (36 files, latest 20260926050000):
--   generation_jobs, provider_tasks, experiments, experiment_arms,
--   channel_connections, analytics_snapshots, retention_snapshots,
--   comments, engagement_insights.
-- Near-duplicates inspected and deliberately NOT duplicated:
--   * renders / video_jobs (exist): the RENDER queue. `generation_jobs` is
--     the DURABLE, provider-agnostic job record (checkpoint/resume,
--     idempotency keys, per-job cost tracking across Text/Image/Video/TTS
--     providers) — a different lifecycle. New table, per the pinned contract.
--   * retention_curves (exists): YouTube-specific audience-retention curves
--     keyed by youtube_video_id. `retention_snapshots` below is the
--     platform-agnostic, scene-mapped snapshot store (F32). New table.
--   * platform_video_stats / video_analytics (exist): per-VIDEO stats.
--     `analytics_snapshots` below is the per-CHANNEL/workspace dashboard
--     snapshot (views/subs/revenue ESTIMATEs, honest deltas). New table.
--   * youtube_connections / meta_connections (exist): platform OAuth token
--     stores (one row per user, encrypted tokens, column-level GRANT
--     revocation). `channel_connections` below is the unified MULTI-channel
--     registry (connection health, quota visibility) that REFERENCES them —
--     it stores no tokens itself. New table.
--
-- PINNED CONTRACTS (implemented exactly — other workers code against these):
--   generation_jobs, provider_tasks.
--
-- Forward-only, non-destructive: CREATE TABLE IF NOT EXISTS only.

-- ── generation_jobs (PINNED CONTRACT) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  job_type text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  idempotency_key text UNIQUE,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  cost_estimate_credits numeric,
  cost_actual_credits numeric,
  provider text,
  model text,
  provider_task_id text,
  error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS generation_jobs_user_idx
  ON public.generation_jobs (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS generation_jobs_project_idx
  ON public.generation_jobs (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS generation_jobs_idempotency_idx
  ON public.generation_jobs (idempotency_key) WHERE idempotency_key IS NOT NULL;

COMMENT ON TABLE public.generation_jobs IS
  'Phase 1 (PINNED): durable, provider-agnostic generation job record — checkpoint/resume, idempotency keys, per-job cost tracking. Distinct from renders (the render queue).';

-- ── provider_tasks (PINNED CONTRACT) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.provider_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.generation_jobs(id) ON DELETE CASCADE,
  provider text NOT NULL,
  model text,
  provider_task_id text,
  status text NOT NULL DEFAULT 'pending',
  attempt integer NOT NULL DEFAULT 1,
  latency_ms integer,
  cost_estimate numeric,
  cost_actual numeric,
  usage jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_ref text,
  error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS provider_tasks_job_idx
  ON public.provider_tasks (job_id, created_at DESC);

COMMENT ON TABLE public.provider_tasks IS
  'Phase 1 (PINNED): per-provider attempt record for a generation_job — model, task id, latency, cost, status, error, usage on every provider output.';

-- ── experiments / experiment_arms (F34 Packaging Experiments) ────────────
CREATE TABLE IF NOT EXISTS public.experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  hypothesis text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'running', 'completed', 'archived')),
  primary_metric text NOT NULL DEFAULT 'ctr',
  started_at timestamptz,
  ended_at timestamptz,
  -- conclusion: stats-disciplined read-out { winner_arm_id, p_value, ... }.
  conclusion jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS experiments_user_idx
  ON public.experiments (user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.experiment_arms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES public.experiments(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Arm',
  arm_type text NOT NULL DEFAULT 'variant'
    CHECK (arm_type IN ('control', 'variant')),
  title_variant_id uuid REFERENCES public.title_variants(id) ON DELETE SET NULL,
  thumbnail_id uuid REFERENCES public.thumbnails(id) ON DELETE SET NULL,
  traffic_split numeric NOT NULL DEFAULT 0.5 CHECK (traffic_split >= 0 AND traffic_split <= 1),
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS experiment_arms_experiment_idx
  ON public.experiment_arms (experiment_id);

COMMENT ON TABLE public.experiments IS
  'Phase 1 (F34): title/thumbnail A/B experiments with stats discipline. Learnings flow into learning_insights (kind=experiment_outcome).';

-- title_variants.experiment_id FK (experiments now exists; column was
-- created without the FK in 20260928020100).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'title_variants_experiment_fk') THEN
    ALTER TABLE public.title_variants
      ADD CONSTRAINT title_variants_experiment_fk
      FOREIGN KEY (experiment_id) REFERENCES public.experiments(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── channel_connections (F27 unified multi-channel registry) ─────────────
CREATE TABLE IF NOT EXISTS public.channel_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  platform text NOT NULL
    CHECK (platform IN ('youtube', 'facebook', 'instagram', 'x', 'tiktok', 'linkedin')),
  external_channel_id text NOT NULL,
  display_name text,
  -- Token stores are NOT duplicated here: the encrypted OAuth tokens stay in
  -- youtube_connections / meta_connections (column-level GRANT revocation).
  youtube_connection_id uuid REFERENCES public.youtube_connections(id) ON DELETE SET NULL,
  meta_connection_id uuid REFERENCES public.meta_connections(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'healthy'
    CHECK (status IN ('healthy', 'degraded', 'expired', 'revoked')),
  -- health: { last_check_at, last_error, ... }. quota: YouTube 3-bucket
  -- visibility (videos.insert / search.list / units) per D65.
  health jsonb NOT NULL DEFAULT '{}'::jsonb,
  quota jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, external_channel_id)
);
CREATE INDEX IF NOT EXISTS channel_connections_user_idx
  ON public.channel_connections (user_id, platform);

COMMENT ON TABLE public.channel_connections IS
  'Phase 1 (F27): unified multi-channel registry — connection health + quota visibility. Tokens are NOT stored here; they stay in youtube_connections/meta_connections.';

-- ── analytics_snapshots (F30/F37 dashboard + monetization) ───────────────
CREATE TABLE IF NOT EXISTS public.analytics_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  channel_id uuid REFERENCES public.channels(id) ON DELETE SET NULL,
  snapshot_date date NOT NULL DEFAULT (now()::date),
  -- metrics: { views, subs, watch_time_minutes, ... }. revenue_usd is an
  -- ESTIMATE only (F37) — never presented as measured without a source.
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  revenue_usd numeric,
  revenue_basis text NOT NULL DEFAULT 'estimate'
    CHECK (revenue_basis IN ('measured', 'estimate')),
  deltas jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analytics_snapshots_channel_idx
  ON public.analytics_snapshots (channel_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS analytics_snapshots_user_idx
  ON public.analytics_snapshots (user_id, snapshot_date DESC);

COMMENT ON TABLE public.analytics_snapshots IS
  'Phase 1 (F30/F37): per-channel dashboard snapshots. Distinct from platform_video_stats/video_analytics (per-video stats). revenue_usd is an ESTIMATE unless revenue_basis=measured.';

-- ── retention_snapshots (F32 scene-aware retention) ───────────────────────
CREATE TABLE IF NOT EXISTS public.retention_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  video_id uuid REFERENCES public.videos(id) ON DELETE SET NULL,
  publish_job_id uuid REFERENCES public.publish_jobs(id) ON DELETE SET NULL,
  youtube_video_id text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  -- points: [{ t, r, scene_id }] — scene-mapped retention; weakest_scene names
  -- the diagnosed weakest scene (D73 honesty rules apply: no invented points).
  points jsonb NOT NULL DEFAULT '[]'::jsonb,
  weakest_scene jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS retention_snapshots_video_idx
  ON public.retention_snapshots (video_id, captured_at DESC);

COMMENT ON TABLE public.retention_snapshots IS
  'Phase 1 (F32): platform-agnostic, scene-mapped retention snapshots. Distinct from retention_curves (YouTube-specific, chapter-aligned).';

-- ── comments / engagement_insights (F36 Comment Intelligence) ────────────
CREATE TABLE IF NOT EXISTS public.comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  video_id uuid REFERENCES public.videos(id) ON DELETE SET NULL,
  platform text NOT NULL DEFAULT 'youtube'
    CHECK (platform IN ('youtube', 'instagram', 'tiktok', 'x', 'facebook', 'linkedin')),
  external_comment_id text NOT NULL,
  author text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  like_count integer NOT NULL DEFAULT 0 CHECK (like_count >= 0),
  published_at timestamptz,
  sentiment text CHECK (sentiment IS NULL OR sentiment IN ('positive', 'neutral', 'negative', 'mixed')),
  is_question boolean NOT NULL DEFAULT false,
  -- replied: a human-confirmed draft reply was posted. Drafts NEVER auto-send
  -- and comments are NEVER auto-deleted (Phase 1 global rules).
  replied boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, external_comment_id)
);
CREATE INDEX IF NOT EXISTS comments_video_idx
  ON public.comments (video_id, published_at DESC);

CREATE TABLE IF NOT EXISTS public.engagement_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL
    CHECK (kind IN ('audience_request', 'question', 'sentiment_shift', 'top_commenter', 'trend')),
  comment_id uuid REFERENCES public.comments(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS engagement_insights_user_idx
  ON public.engagement_insights (user_id, kind, created_at DESC);

COMMENT ON TABLE public.comments IS
  'Phase 1 (F36): mined comments → audience requests → ideas. Draft replies need human confirm; never auto-delete.';
COMMENT ON TABLE public.engagement_insights IS
  'Phase 1 (F36): DERIVED engagement insights (mined from comments). Raw comments live in comments.';

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiment_arms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retention_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS generation_jobs_owner ON public.generation_jobs;
CREATE POLICY generation_jobs_owner ON public.generation_jobs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS provider_tasks_owner ON public.provider_tasks;
CREATE POLICY provider_tasks_owner ON public.provider_tasks
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.generation_jobs g
            WHERE g.id = provider_tasks.job_id AND g.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.generation_jobs g
            WHERE g.id = provider_tasks.job_id AND g.user_id = auth.uid())
  );

DROP POLICY IF EXISTS experiments_owner ON public.experiments;
CREATE POLICY experiments_owner ON public.experiments
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS experiment_arms_owner ON public.experiment_arms;
CREATE POLICY experiment_arms_owner ON public.experiment_arms
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.experiments e
            WHERE e.id = experiment_arms.experiment_id AND e.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.experiments e
            WHERE e.id = experiment_arms.experiment_id AND e.user_id = auth.uid())
  );

DROP POLICY IF EXISTS channel_connections_owner ON public.channel_connections;
CREATE POLICY channel_connections_owner ON public.channel_connections
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS analytics_snapshots_owner ON public.analytics_snapshots;
CREATE POLICY analytics_snapshots_owner ON public.analytics_snapshots
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS retention_snapshots_owner ON public.retention_snapshots;
CREATE POLICY retention_snapshots_owner ON public.retention_snapshots
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS comments_owner ON public.comments;
CREATE POLICY comments_owner ON public.comments
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS engagement_insights_owner ON public.engagement_insights;
CREATE POLICY engagement_insights_owner ON public.engagement_insights
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- RESTRICTIVE "No guest sessions" on every new table (mirrors the pattern
-- from migration 20260925112402; new tables carry their own copy).
DO $$
DECLARE
  t text;
  tbls text[] := ARRAY[
    'generation_jobs', 'provider_tasks', 'experiments', 'experiment_arms',
    'channel_connections', 'analytics_snapshots', 'retention_snapshots',
    'comments', 'engagement_insights'
  ];
BEGIN
  FOREACH t IN ARRAY tbls
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "No guest sessions" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "No guest sessions" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      || 'USING (COALESCE((auth.jwt() ->> ''is_anonymous'')::boolean, false) IS NOT TRUE) '
      || 'WITH CHECK (COALESCE((auth.jwt() ->> ''is_anonymous'')::boolean, false) IS NOT TRUE)',
      t
    );
  END LOOP;
END $$;

-- updated_at triggers
DROP TRIGGER IF EXISTS generation_jobs_touch_updated_at ON public.generation_jobs;
CREATE TRIGGER generation_jobs_touch_updated_at BEFORE UPDATE ON public.generation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS provider_tasks_touch_updated_at ON public.provider_tasks;
CREATE TRIGGER provider_tasks_touch_updated_at BEFORE UPDATE ON public.provider_tasks
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS experiments_touch_updated_at ON public.experiments;
CREATE TRIGGER experiments_touch_updated_at BEFORE UPDATE ON public.experiments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS experiment_arms_touch_updated_at ON public.experiment_arms;
CREATE TRIGGER experiment_arms_touch_updated_at BEFORE UPDATE ON public.experiment_arms
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS channel_connections_touch_updated_at ON public.channel_connections;
CREATE TRIGGER channel_connections_touch_updated_at BEFORE UPDATE ON public.channel_connections
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS retention_snapshots_touch_updated_at ON public.retention_snapshots;
CREATE TRIGGER retention_snapshots_touch_updated_at BEFORE UPDATE ON public.retention_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS comments_touch_updated_at ON public.comments;
CREATE TRIGGER comments_touch_updated_at BEFORE UPDATE ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
