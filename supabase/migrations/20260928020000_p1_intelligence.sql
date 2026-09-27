-- Phase 1 (Foundation) — Intelligence domain.
--
-- RECONCILIATION (D88: extend, don't migrate). All tables below were verified
-- MISSING from supabase/migrations (36 files, latest 20260926050000):
--   channels, channel_snapshots, niche_snapshots, competitor_channels,
--   videos, video_snapshots, research_sources, research_claims.
-- Near-duplicates inspected and deliberately NOT duplicated:
--   * outlier_videos (exists) is YouTube-only, bound to research_projects, and
--     ideation-oriented (outlier_score, patterns). It is INADEQUATE as the
--     canonical intelligence video store, so `videos` is created as the
--     multi-platform, channel-linked entity with a time-series
--     (`video_snapshots`). outlier_videos keeps serving the outlier-import
--     surface; a future migration may backfill videos from it.
--   * channel_stats / video_analytics / platform_video_stats (exist) are
--     per-user analytics reads. `channels`/`videos` are the tracked-entity
--     registry they join against; no overlap.
--   * client_channels (exists) is the agency tier's client-handle registry
--     (workspace-scoped, handle only). `channels` is the intelligence
--     registry (stats-tracked, snapshots). Different domains.
--
-- Forward-only, non-destructive: CREATE TABLE IF NOT EXISTS only.

-- ── channels ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  platform text NOT NULL DEFAULT 'youtube'
    CHECK (platform IN ('youtube', 'instagram', 'tiktok', 'x', 'facebook', 'linkedin')),
  external_channel_id text NOT NULL,
  handle text,
  title text,
  -- is_own: the creator's own channel (analytics-grade) vs a tracked competitor.
  is_own boolean NOT NULL DEFAULT false,
  tracked boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, external_channel_id)
);
CREATE INDEX IF NOT EXISTS channels_user_idx ON public.channels (user_id, tracked);

COMMENT ON TABLE public.channels IS
  'Phase 1: intelligence registry of tracked channels (own + competitor). Own-channel analytics rows (channel_stats, platform_video_stats) join against this; snapshots live in channel_snapshots.';

-- ── channel_snapshots ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.channel_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  captured_at timestamptz NOT NULL DEFAULT now(),
  subscriber_count bigint,
  video_count bigint,
  view_count bigint,
  -- metrics: platform-raw counters not given first-class columns.
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS channel_snapshots_channel_idx
  ON public.channel_snapshots (channel_id, captured_at DESC);

COMMENT ON TABLE public.channel_snapshots IS
  'Phase 1: time-series snapshots of channel counters. Growth/delta math reads snapshots, never live API values.';

-- ── niche_snapshots ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.niche_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  niche_id uuid NOT NULL REFERENCES public.niches(id) ON DELETE CASCADE,
  captured_at timestamptz NOT NULL DEFAULT now(),
  -- score: explainable opportunity scoring factors + confidence at capture time.
  score jsonb NOT NULL DEFAULT '{}'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'youtube-data-api'
);
CREATE INDEX IF NOT EXISTS niche_snapshots_niche_idx
  ON public.niche_snapshots (niche_id, captured_at DESC);

COMMENT ON TABLE public.niche_snapshots IS
  'Phase 1 (F1/F6): timestamped niche opportunity scores with the factors that produced them. Freshness labels derive from captured_at.';

-- ── competitor_channels ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.competitor_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  niche_id uuid REFERENCES public.niches(id) ON DELETE SET NULL,
  platform text NOT NULL DEFAULT 'youtube'
    CHECK (platform IN ('youtube', 'instagram', 'tiktok', 'x', 'facebook', 'linkedin')),
  external_channel_id text NOT NULL,
  handle text,
  title text,
  status text NOT NULL DEFAULT 'watching'
    CHECK (status IN ('watching', 'paused', 'archived')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, external_channel_id)
);
CREATE INDEX IF NOT EXISTS competitor_channels_user_idx
  ON public.competitor_channels (user_id, niche_id);

COMMENT ON TABLE public.competitor_channels IS
  'Phase 1 (F3): explicit competitor watchlist, optionally grouped by niche. Distinct from channels (tracked entities with snapshots) and client_channels (agency handles).';

-- ── videos ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_id uuid REFERENCES public.channels(id) ON DELETE SET NULL,
  platform text NOT NULL DEFAULT 'youtube'
    CHECK (platform IN ('youtube', 'instagram', 'tiktok', 'x', 'facebook', 'linkedin')),
  external_video_id text NOT NULL,
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  published_at timestamptz,
  duration_seconds numeric,
  thumbnail_url text,
  -- is_own: the creator's own video vs a competitor/outlier video.
  is_own boolean NOT NULL DEFAULT false,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, external_video_id)
);
CREATE INDEX IF NOT EXISTS videos_channel_idx ON public.videos (channel_id, published_at DESC);

COMMENT ON TABLE public.videos IS
  'Phase 1 (F4/F5): canonical intelligence video entity (own + competitor), multi-platform. outlier_videos stays the import/ideation surface; videos is the analytics-grade store. Vector embedding added in 20260928020500.';

-- ── video_snapshots ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.video_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  captured_at timestamptz NOT NULL DEFAULT now(),
  view_count bigint,
  like_count bigint,
  comment_count bigint,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS video_snapshots_video_idx
  ON public.video_snapshots (video_id, captured_at DESC);

COMMENT ON TABLE public.video_snapshots IS
  'Phase 1 (F4/F5): per-video metric time series. Velocity/outlier math derives from snapshots.';

-- ── research_sources ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.research_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  research_project_id uuid REFERENCES public.research_projects(id) ON DELETE CASCADE,
  source_type text NOT NULL DEFAULT 'web'
    CHECK (source_type IN ('web', 'video', 'paper', 'transcript', 'upload', 'other')),
  url text,
  title text NOT NULL DEFAULT '',
  excerpt text NOT NULL DEFAULT '',
  content text,
  published_at timestamptz,
  credibility jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS research_sources_project_idx
  ON public.research_sources (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS research_sources_research_project_idx
  ON public.research_sources (research_project_id, created_at DESC);

COMMENT ON TABLE public.research_sources IS
  'Phase 1 (F9/F11): visual-research canvas + deep-research evidence sources per project. Vector embedding added in 20260928020500.';

-- ── research_claims ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.research_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES public.research_sources(id) ON DELETE CASCADE,
  claim text NOT NULL,
  verdict text NOT NULL DEFAULT 'unsupported'
    CHECK (verdict IN ('verified', 'qualified', 'unsupported', 'disputed')),
  -- evidence: quoted spans / timestamps backing the verdict. Strict mode
  -- blocks unsupported claims from entering scripts.
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS research_claims_source_idx
  ON public.research_claims (source_id);

COMMENT ON TABLE public.research_claims IS
  'Phase 1 (F11): claim-level citations. Every factual claim in a script must resolve to a verified/qualified claim row.';

-- ── RLS: owner-scoped everywhere ─────────────────────────────────────────
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.niche_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS channels_owner ON public.channels;
CREATE POLICY channels_owner ON public.channels
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS channel_snapshots_owner ON public.channel_snapshots;
CREATE POLICY channel_snapshots_owner ON public.channel_snapshots
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.channels c
            WHERE c.id = channel_snapshots.channel_id AND c.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.channels c
            WHERE c.id = channel_snapshots.channel_id AND c.user_id = auth.uid())
  );

DROP POLICY IF EXISTS niche_snapshots_owner ON public.niche_snapshots;
CREATE POLICY niche_snapshots_owner ON public.niche_snapshots
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.niches n
            WHERE n.id = niche_snapshots.niche_id AND n.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.niches n
            WHERE n.id = niche_snapshots.niche_id AND n.user_id = auth.uid())
  );

DROP POLICY IF EXISTS competitor_channels_owner ON public.competitor_channels;
CREATE POLICY competitor_channels_owner ON public.competitor_channels
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS videos_owner ON public.videos;
CREATE POLICY videos_owner ON public.videos
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS video_snapshots_owner ON public.video_snapshots;
CREATE POLICY video_snapshots_owner ON public.video_snapshots
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.videos v
            WHERE v.id = video_snapshots.video_id AND v.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.videos v
            WHERE v.id = video_snapshots.video_id AND v.user_id = auth.uid())
  );

DROP POLICY IF EXISTS research_sources_owner ON public.research_sources;
CREATE POLICY research_sources_owner ON public.research_sources
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS research_claims_owner ON public.research_claims;
CREATE POLICY research_claims_owner ON public.research_claims
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.research_sources s
            WHERE s.id = research_claims.source_id AND s.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.research_sources s
            WHERE s.id = research_claims.source_id AND s.user_id = auth.uid())
  );

-- RESTRICTIVE "No guest sessions" on every new table (mirrors the pattern
-- from migration 20260925112402; that migration's DO block only covered
-- tables existing at the time, so new tables carry their own copy).
DO $$
DECLARE
  t text;
  tbls text[] := ARRAY[
    'channels', 'channel_snapshots', 'niche_snapshots', 'competitor_channels',
    'videos', 'video_snapshots', 'research_sources', 'research_claims'
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
DROP TRIGGER IF EXISTS channels_touch_updated_at ON public.channels;
CREATE TRIGGER channels_touch_updated_at BEFORE UPDATE ON public.channels
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS competitor_channels_touch_updated_at ON public.competitor_channels;
CREATE TRIGGER competitor_channels_touch_updated_at BEFORE UPDATE ON public.competitor_channels
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS videos_touch_updated_at ON public.videos;
CREATE TRIGGER videos_touch_updated_at BEFORE UPDATE ON public.videos
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS research_sources_touch_updated_at ON public.research_sources;
CREATE TRIGGER research_sources_touch_updated_at BEFORE UPDATE ON public.research_sources
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS research_claims_touch_updated_at ON public.research_claims;
CREATE TRIGGER research_claims_touch_updated_at BEFORE UPDATE ON public.research_claims
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
