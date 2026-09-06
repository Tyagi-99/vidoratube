-- P0 PR2: rights-aware content spine + durable workflow_jobs
-- Does not modify legacy video_jobs. Projects remain the production workspace.

-- ---------------------------------------------------------------------------
-- Enums (text + check constraints for Lovable/Supabase friendliness)
-- ---------------------------------------------------------------------------

CREATE TABLE public.niches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  slug text not null,
  enabled boolean not null default true,
  keywords text[] not null default '{}',
  hashtags text[] not null default '{}',
  search_queries text[] not null default '{}',
  target_platforms text[] not null default array['youtube']::text[],
  min_views integer not null default 0,
  min_engagement_rate numeric not null default 0,
  preferred_duration_seconds_min integer,
  preferred_duration_seconds_max integer,
  preferred_format text not null default 'short',
  preferred_language text not null default 'en',
  content_style text not null default 'general',
  scoring_weights jsonb not null default '{"relevance":1,"engagement":1,"freshness":1,"velocity":1}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);
CREATE INDEX niches_user_idx ON public.niches(user_id, enabled);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.niches TO authenticated;
GRANT ALL ON public.niches TO service_role;
ALTER TABLE public.niches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "niches_own" ON public.niches FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner'))
  WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER niches_touch_updated_at BEFORE UPDATE ON public.niches
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.creators (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default '',
  notes text,
  niche_tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
CREATE INDEX creators_user_idx ON public.creators(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.creators TO authenticated;
GRANT ALL ON public.creators TO service_role;
ALTER TABLE public.creators ENABLE ROW LEVEL SECURITY;
CREATE POLICY "creators_own" ON public.creators FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner'))
  WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER creators_touch_updated_at BEFORE UPDATE ON public.creators
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.creator_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  creator_id uuid not null references public.creators(id) on delete cascade,
  platform text not null,
  username text,
  profile_url text,
  platform_user_id text,
  followers integer,
  engagement_rate numeric,
  public_contact text,
  permission_status text not null default 'unknown'
    check (permission_status in (
      'unknown','permission_required','permission_requested','permission_granted',
      'permission_denied','licensed','public_domain','do_not_use'
    )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, platform, profile_url)
);
CREATE INDEX creator_accounts_creator_idx ON public.creator_accounts(creator_id);
CREATE INDEX creator_accounts_user_idx ON public.creator_accounts(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.creator_accounts TO authenticated;
GRANT ALL ON public.creator_accounts TO service_role;
ALTER TABLE public.creator_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "creator_accounts_own" ON public.creator_accounts FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner'))
  WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER creator_accounts_touch_updated_at BEFORE UPDATE ON public.creator_accounts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.content_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  niche_id uuid references public.niches(id) on delete set null,
  creator_id uuid references public.creators(id) on delete set null,
  creator_account_id uuid references public.creator_accounts(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  source_kind text not null default 'discovered'
    check (source_kind in ('discovered','manual_url','stock','upload')),
  platform text not null default 'youtube',
  platform_id text,
  canonical_url text not null,
  title text,
  description text,
  caption text,
  thumbnail_url text,
  language text,
  duration_seconds integer,
  uploaded_at timestamptz,
  hashtags text[] not null default '{}',
  tags text[] not null default '{}',
  category text,
  discovery_date timestamptz not null default now(),
  -- raw platform facts (never invent)
  views bigint,
  likes bigint,
  comments bigint,
  shares bigint,
  followers bigint,
  raw_metadata jsonb not null default '{}'::jsonb,
  -- calculated scores (nullable when inputs missing)
  engagement_score numeric,
  freshness_score numeric,
  view_velocity numeric,
  niche_relevance_score numeric,
  viral_potential_score numeric,
  metadata_incomplete boolean not null default false,
  pipeline_stage text not null default 'discovered'
    check (pipeline_stage in (
      'discovered','shortlisted','rights_check','approved','asset_acquired',
      'analyzed','script_generated','voiceover_generated','captions_generated',
      'edited','qa','ready','published','failed','rejected'
    )),
  rights_status text not null default 'unknown'
    check (rights_status in (
      'unknown','permission_required','permission_requested','permission_granted',
      'permission_denied','licensed','public_domain','do_not_use'
    )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, canonical_url)
);
CREATE INDEX content_items_user_stage_idx ON public.content_items(user_id, pipeline_stage);
CREATE INDEX content_items_platform_id_idx ON public.content_items(user_id, platform, platform_id);
CREATE INDEX content_items_niche_idx ON public.content_items(niche_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_items TO authenticated;
GRANT ALL ON public.content_items TO service_role;
ALTER TABLE public.content_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "content_items_own" ON public.content_items FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner'))
  WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER content_items_touch_updated_at BEFORE UPDATE ON public.content_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.rights_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  creator_account_id uuid references public.creator_accounts(id) on delete set null,
  status text not null
    check (status in (
      'unknown','permission_required','permission_requested','permission_granted',
      'permission_denied','licensed','public_domain','do_not_use'
    )),
  evidence_url text,
  evidence_notes text not null default '',
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
CREATE INDEX rights_decisions_content_idx ON public.rights_decisions(content_item_id, decided_at desc);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rights_decisions TO authenticated;
GRANT ALL ON public.rights_decisions TO service_role;
ALTER TABLE public.rights_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rights_decisions_own" ON public.rights_decisions FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner'))
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.content_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  kind text not null check (kind in ('source','working','final')),
  origin text not null check (origin in ('user_upload','stock','generated','other')),
  rights_basis text not null default '',
  storage_path text,
  source_url text,
  mime_type text,
  bytes bigint,
  checksum_sha256 text,
  perceptual_hash text,
  width integer,
  height integer,
  duration_seconds numeric,
  technical_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
CREATE INDEX content_assets_content_idx ON public.content_assets(content_item_id, kind);
CREATE INDEX content_assets_checksum_idx ON public.content_assets(user_id, checksum_sha256);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_assets TO authenticated;
GRANT ALL ON public.content_assets TO service_role;
ALTER TABLE public.content_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "content_assets_own" ON public.content_assets FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner'))
  WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER content_assets_touch_updated_at BEFORE UPDATE ON public.content_assets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.content_duplicate_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  duplicate_of_id uuid references public.content_items(id) on delete set null,
  match_type text not null check (match_type in (
    'canonical_url','platform_id','file_hash','perceptual_hash','title_duration','other'
  )),
  confidence numeric not null default 1,
  status text not null default 'flagged' check (status in ('flagged','confirmed','dismissed')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
CREATE INDEX content_duplicate_flags_item_idx ON public.content_duplicate_flags(content_item_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_duplicate_flags TO authenticated;
GRANT ALL ON public.content_duplicate_flags TO service_role;
ALTER TABLE public.content_duplicate_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "content_duplicate_flags_own" ON public.content_duplicate_flags FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner'))
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.workflow_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_item_id uuid references public.content_items(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  job_type text not null,
  stage text not null default 'queued',
  status text not null default 'pending'
    check (status in ('pending','running','succeeded','failed','cancelled','waiting_approval')),
  progress numeric not null default 0,
  attempt integer not null default 0,
  max_attempts integer not null default 5,
  idempotency_key text,
  error text,
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  locked_at timestamptz,
  locked_by text,
  run_after timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
CREATE INDEX workflow_jobs_claim_idx ON public.workflow_jobs(status, run_after, created_at)
  WHERE status in ('pending','running');
CREATE INDEX workflow_jobs_user_idx ON public.workflow_jobs(user_id, created_at desc);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workflow_jobs TO authenticated;
GRANT ALL ON public.workflow_jobs TO service_role;
ALTER TABLE public.workflow_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workflow_jobs_own" ON public.workflow_jobs FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner'))
  WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER workflow_jobs_touch_updated_at BEFORE UPDATE ON public.workflow_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.workflow_job_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workflow_job_id uuid not null references public.workflow_jobs(id) on delete cascade,
  level text not null default 'info' check (level in ('debug','info','warn','error')),
  message text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
CREATE INDEX workflow_job_events_job_idx ON public.workflow_job_events(workflow_job_id, created_at);
GRANT SELECT, INSERT ON public.workflow_job_events TO authenticated;
GRANT ALL ON public.workflow_job_events TO service_role;
ALTER TABLE public.workflow_job_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workflow_job_events_own" ON public.workflow_job_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner'));
CREATE POLICY "workflow_job_events_insert_own" ON public.workflow_job_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Rights gate helper: approved rights required before asset acquisition
CREATE OR REPLACE FUNCTION public.content_rights_approved(_content_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.content_items c
    WHERE c.id = _content_id
      AND c.rights_status IN ('permission_granted','licensed','public_domain')
  );
$$;
REVOKE ALL ON FUNCTION public.content_rights_approved(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.content_rights_approved(uuid) TO authenticated, service_role;
