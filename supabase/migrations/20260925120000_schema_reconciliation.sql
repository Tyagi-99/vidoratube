-- Schema reconciliation (2026-09-25).
--
-- WHAT HAPPENED: Lovable's AI assistant, when asked for the publish error log,
-- instead created 18 simplified tables (derived from code, not from these
-- reviewed migrations) and applied them to the live database, plus 5 migration
-- files (now deleted). Those tables had wrong column types (e.g. niches TEXT[]
-- instead of JSONB), missing NOT NULL constraints, missing foreign keys,
-- missing indexes, and missing updated_at columns.
--
-- WHAT THIS DOES: Drops those 18 AI-created tables (they were created minutes
-- ago on a pre-launch database with no users and no data) and recreates the
-- full reviewed P2-P10 schema. This file supersedes the individual
-- 20260925* P0-P10 migration files (deleted in the same commit); their
-- contents are concatenated below in order.
--
-- SAFE TO RE-RUN: All statements are IF NOT EXISTS / idempotent, except the
-- initial DROPs which are IF EXISTS.

-- Step 1: Remove the AI-created simplified tables (empty, pre-launch).
DROP TABLE IF EXISTS public.asset_provenance CASCADE;
DROP TABLE IF EXISTS public.billing_events CASCADE;
DROP TABLE IF EXISTS public.channel_stats CASCADE;
DROP TABLE IF EXISTS public.characters CASCADE;
DROP TABLE IF EXISTS public.learning_insights CASCADE;
DROP TABLE IF EXISTS public.music_tracks CASCADE;
DROP TABLE IF EXISTS public.outlier_videos CASCADE;
DROP TABLE IF EXISTS public.plans CASCADE;
DROP TABLE IF EXISTS public.publish_jobs CASCADE;
DROP TABLE IF EXISTS public.referrals CASCADE;
DROP TABLE IF EXISTS public.research_projects CASCADE;
DROP TABLE IF EXISTS public.safety_scores CASCADE;
DROP TABLE IF EXISTS public.seo_metadata CASCADE;
DROP TABLE IF EXISTS public.subscriptions CASCADE;
DROP TABLE IF EXISTS public.thumbnails CASCADE;
DROP TABLE IF EXISTS public.video_analytics CASCADE;
DROP TABLE IF EXISTS public.video_ideas CASCADE;
DROP TABLE IF EXISTS public.youtube_api_cache CASCADE;

-- Step 2: Full reviewed P2-P10 schema (concatenated in order).

-- ── from supabase/migrations/20260925060000_atomic_credit_ledger.sql ──
-- Atomic credit mutations: balance update + ledger insert happen in a single
-- transaction so concurrent requests can never double-spend, and a failure
-- between the two can never diverge the balance from the audit trail.
--
-- Apply via Supabase SQL editor or `supabase db push` (see docs/THREE-MODES.md).
-- These functions are service_role-only; server functions validate the caller's
-- JWT before invoking them.

-- Reference which job a ledger entry belongs to (NULL for manual adjustments).
ALTER TABLE public.credit_ledger
  ADD COLUMN IF NOT EXISTS ref_id UUID;

-- Debit exactly one credit for a video job. Raises INSUFFICIENT_CREDITS when the
-- balance is too low. Concurrent callers serialize on the profiles row lock, so
-- two requests with 1 credit cannot both succeed.
CREATE OR REPLACE FUNCTION public.debit_credits_for_job(
  p_user_id UUID,
  p_reason TEXT,
  p_job_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credits INTEGER;
BEGIN
  UPDATE public.profiles
    SET credits = credits - 1
    WHERE id = p_user_id AND credits >= 1
    RETURNING credits INTO v_credits;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSUFFICIENT_CREDITS';
  END IF;

  INSERT INTO public.credit_ledger (user_id, delta, reason, ref_id)
    VALUES (p_user_id, -1, p_reason, p_job_id);

  RETURN v_credits;
END;
$$;

-- Refund one credit for a job (stale-job reaper). Idempotent per job: if a
-- refund for p_job_id already exists the call is a no-op returning the current
-- balance, so concurrent/duplicate reapers cannot double-refund.
CREATE OR REPLACE FUNCTION public.refund_credits(
  p_user_id UUID,
  p_reason TEXT,
  p_job_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credits INTEGER;
BEGIN
  -- Lock the profile row first so concurrent refunds for the same user
  -- serialize and the duplicate check below is race-safe.
  UPDATE public.profiles
    SET credits = credits
    WHERE id = p_user_id
    RETURNING credits INTO v_credits;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND';
  END IF;

  IF p_job_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.credit_ledger
    WHERE user_id = p_user_id AND ref_id = p_job_id AND delta > 0
  ) THEN
    RETURN v_credits;
  END IF;

  UPDATE public.profiles
    SET credits = credits + 1
    WHERE id = p_user_id
    RETURNING credits INTO v_credits;

  INSERT INTO public.credit_ledger (user_id, delta, reason, ref_id)
    VALUES (p_user_id, 1, p_reason, p_job_id);

  RETURN v_credits;
END;
$$;

-- General atomic adjustment (admin grants/revokes). Preserves the historical
-- clamp-at-zero behavior; the ledger records the requested delta.
CREATE OR REPLACE FUNCTION public.adjust_credits(
  p_user_id UUID,
  p_delta INTEGER,
  p_reason TEXT,
  p_admin_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credits INTEGER;
BEGIN
  UPDATE public.profiles
    SET credits = GREATEST(0, credits + p_delta)
    WHERE id = p_user_id
    RETURNING credits INTO v_credits;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND';
  END IF;

  INSERT INTO public.credit_ledger (user_id, delta, reason, admin_id)
    VALUES (p_user_id, p_delta, p_reason, p_admin_id);

  RETURN v_credits;
END;
$$;

REVOKE ALL ON FUNCTION public.debit_credits_for_job(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_credits(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.adjust_credits(UUID, INTEGER, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debit_credits_for_job(UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_credits(UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.adjust_credits(UUID, INTEGER, TEXT, UUID) TO service_role;

-- ── from supabase/migrations/20260925064000_storage_buckets_private.sql ──
-- Ensure the generated-videos bucket exists and is private.
-- No bucket DDL shipped with the repo (the bucket was created via dashboard/CLI),
-- so its public/private flag was unverifiable from code. Storage RLS policies
-- scope objects to the owning user's folder; a public bucket would bypass those
-- policies entirely by making every object world-readable.
INSERT INTO storage.buckets (id, name, public)
VALUES ('generated-videos', 'generated-videos', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- ── from supabase/migrations/20260925064100_content_rights_ownership.sql ──
-- Close the content_rights_approved oracle.
-- The function is SECURITY DEFINER with EXECUTE granted to `authenticated` but
-- performed no ownership check, so any signed-in user could probe arbitrary
-- content ids and infer row existence / rights status. Scope it to the caller's
-- own rows. (No runtime callers exist today besides the type declaration, so
-- nothing depends on cross-user probing.)
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
      AND c.user_id = auth.uid()
      AND c.rights_status IN (
        'permission_granted','licensed','owned','public_domain'
      )
  );
$$;

REVOKE ALL ON FUNCTION public.content_rights_approved(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.content_rights_approved(uuid) TO authenticated, service_role;

-- ── from supabase/migrations/20260925064200_api_usage_insert_lockdown.sql ──
-- Lock down api_usage writes: cost rows are server-written only.
-- The client INSERT policy (WITH CHECK auth.uid() = user_id) let any user
-- fabricate cost/analytics rows. All real writes go through the service role
-- (see studio.server.ts); reads of one's own rows are unchanged.
DROP POLICY IF EXISTS "api_usage_insert" ON public.api_usage;
REVOKE INSERT ON public.api_usage FROM authenticated;

-- ── from supabase/migrations/20260925140000_billing_abuse_hardening.sql ──
-- P1 billing/abuse hardening.
--
-- 1. Verification-gated free credits: profiles.credits default 10 -> 0 (existing
--    rows untouched); 10 credits granted only when auth.users.email_confirmed_at
--    flips NULL -> set, the domain is not disposable, and free_credits_granted
--    is false. Google OAuth users confirm on signup, so they are credited
--    immediately.
-- 2. disposable_email_domains blocklist (seeded).
-- 3. abuse_signals table (admin read-only, service_role writes).
-- 4. Postgres rate-limit buckets + atomic check_rate_limit() (source of truth;
--    the in-memory limiter remains as a cheap first-line check).
-- 5. video_jobs.idempotency_key for safe client retries.
-- 6. debit_credits_for_job_once(): idempotent per-job debit for Modes 2/3.
-- 7. log_abuse_signal(): logs a signal and returns the size of the free-tier
--    cluster sharing the caller's /24 (or /64 for IPv6) or device hash.

-- ===== 1. profiles: default 0 + grant flag =====
ALTER TABLE public.profiles
  ALTER COLUMN credits SET DEFAULT 0;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS free_credits_granted BOOLEAN NOT NULL DEFAULT FALSE;

-- ===== 2. disposable email blocklist =====
CREATE TABLE IF NOT EXISTS public.disposable_email_domains (
  domain TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.disposable_email_domains ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Disposable domains are public" ON public.disposable_email_domains;
CREATE POLICY "Disposable domains are public" ON public.disposable_email_domains
  FOR SELECT USING (true);
GRANT SELECT ON public.disposable_email_domains TO anon, authenticated;
GRANT ALL ON public.disposable_email_domains TO service_role;

INSERT INTO public.disposable_email_domains (domain) VALUES
  ('mailinator.com'), ('mailinator.net'), ('mailinator.org'),
  ('tempmail.com'), ('tempmail.net'), ('temp-mail.org'), ('temp-mail.io'),
  ('tempmailo.com'), ('tempail.com'), ('tempmailaddress.com'),
  ('10minutemail.com'), ('10minutemail.net'), ('20minutemail.com'),
  ('guerrillamail.com'), ('guerrillamail.net'), ('guerrillamail.org'),
  ('guerrillamailblock.com'),
  ('yopmail.com'), ('yopmail.net'),
  ('trashmail.com'), ('trashmail.net'),
  ('throwawaymail.com'), ('fakeinbox.com'), ('emailfake.com'), ('fakemail.net'),
  ('getnada.com'), ('burnermail.io'), ('sharklasers.com'), ('mohmal.com'),
  ('emailondeck.com'), ('tempinbox.com'), ('dispostable.com'),
  ('maildrop.cc'), ('harakirimail.com'), ('spamgourmet.com'),
  ('mytemp.email'), ('mail.tm'),
  ('1secmail.com'), ('1secmail.net'), ('1secmail.org'),
  ('anonbox.net'), ('dropmail.me'), ('mailsac.com'), ('mintemail.com'),
  ('moakt.com'), ('jetable.org'), ('incognitomail.org'),
  ('mailnesia.com'), ('mailcatch.com'), ('inboxkitten.com')
ON CONFLICT (domain) DO NOTHING;

-- ===== 3. abuse_signals =====
CREATE TABLE IF NOT EXISTS public.abuse_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ip INET,
  device_hash TEXT,
  signal_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.abuse_signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read abuse signals" ON public.abuse_signals;
CREATE POLICY "Admins read abuse signals" ON public.abuse_signals
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
-- No INSERT/UPDATE/DELETE policies for authenticated: service_role writes only.
GRANT ALL ON public.abuse_signals TO service_role;
CREATE INDEX IF NOT EXISTS abuse_signals_ip_idx ON public.abuse_signals (ip);
CREATE INDEX IF NOT EXISTS abuse_signals_device_idx ON public.abuse_signals (device_hash);
CREATE INDEX IF NOT EXISTS abuse_signals_user_idx ON public.abuse_signals (user_id);
CREATE INDEX IF NOT EXISTS abuse_signals_created_idx ON public.abuse_signals (created_at);

-- ===== 4. Postgres rate-limit buckets =====
CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  bucket_key TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  hit_count INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role (which bypasses RLS) touches this table.
GRANT ALL ON public.rate_limit_buckets TO service_role;

-- Atomic sliding-window check. Returns TRUE when the hit is allowed (and
-- records it), FALSE when the key is over quota. Concurrent callers serialize
-- on the bucket row lock; the INSERT ... ON CONFLICT handles the
-- concurrent-first-hit race.
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key TEXT,
  p_max INTEGER,
  p_window_seconds INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_count INTEGER;
  v_cutoff TIMESTAMPTZ;
BEGIN
  IF p_max < 1 OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'INVALID_RATE_LIMIT_ARGS';
  END IF;
  v_cutoff := now() - make_interval(secs => p_window_seconds);

  INSERT INTO public.rate_limit_buckets (bucket_key, window_start, hit_count)
  VALUES (p_key, now(), 0)
  ON CONFLICT (bucket_key) DO NOTHING;

  SELECT window_start, hit_count INTO v_window_start, v_count
  FROM public.rate_limit_buckets
  WHERE bucket_key = p_key
  FOR UPDATE;

  IF v_window_start < v_cutoff THEN
    UPDATE public.rate_limit_buckets
    SET window_start = now(), hit_count = 1
    WHERE bucket_key = p_key;
    RETURN TRUE;
  END IF;

  IF v_count >= p_max THEN
    RETURN FALSE;
  END IF;

  UPDATE public.rate_limit_buckets
  SET hit_count = hit_count + 1
  WHERE bucket_key = p_key;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;

-- ===== 5. video_jobs.idempotency_key =====
ALTER TABLE public.video_jobs
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE INDEX IF NOT EXISTS video_jobs_idempotency_idx
  ON public.video_jobs (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ===== 6. idempotent per-job debit (Modes 2/3) =====
-- Same atomicity as debit_credits_for_job, plus: a second call with the same
-- p_job_id is a no-op returning the current balance, so retries and
-- multi-step flows (script gen -> TTS) can never double-charge one project.
CREATE OR REPLACE FUNCTION public.debit_credits_for_job_once(
  p_user_id UUID,
  p_reason TEXT,
  p_job_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credits INTEGER;
BEGIN
  -- Serialize per user so the duplicate check below is race-safe.
  SELECT credits INTO v_credits
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND';
  END IF;

  IF p_job_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.credit_ledger
    WHERE user_id = p_user_id AND ref_id = p_job_id AND delta < 0
  ) THEN
    RETURN v_credits;
  END IF;

  IF v_credits < 1 THEN
    RAISE EXCEPTION 'INSUFFICIENT_CREDITS';
  END IF;

  UPDATE public.profiles
  SET credits = credits - 1
  WHERE id = p_user_id
  RETURNING credits INTO v_credits;

  INSERT INTO public.credit_ledger (user_id, delta, reason, ref_id)
  VALUES (p_user_id, -1, p_reason, p_job_id);

  RETURN v_credits;
END;
$$;

REVOKE ALL ON FUNCTION public.debit_credits_for_job_once(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debit_credits_for_job_once(UUID, TEXT, UUID) TO service_role;

-- ===== 7. grant 10 free credits on email confirmation =====
CREATE OR REPLACE FUNCTION public.grant_free_credits_on_verify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_domain TEXT;
  v_already BOOLEAN;
BEGIN
  -- Only when the email transitions from unconfirmed to confirmed.
  -- (On INSERT, OLD is null, so Google OAuth signups — confirmed immediately —
  -- are credited right away.)
  IF OLD.email_confirmed_at IS NOT NULL OR NEW.email_confirmed_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  -- Profile must exist (created by handle_new_user on INSERT).
  SELECT free_credits_granted INTO v_already
  FROM public.profiles
  WHERE id = NEW.id;
  IF NOT FOUND OR v_already THEN
    RETURN NEW;
  END IF;

  -- Disposable domains get nothing.
  v_domain := lower(split_part(NEW.email, '@', 2));
  IF EXISTS (SELECT 1 FROM public.disposable_email_domains WHERE domain = v_domain) THEN
    RETURN NEW;
  END IF;

  PERFORM public.adjust_credits(NEW.id, 10, 'Free signup credits');
  UPDATE public.profiles SET free_credits_granted = TRUE WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_free_credits_on_verify() FROM PUBLIC, anon, authenticated;

-- Alphabetical trigger ordering puts this after on_auth_user_created, so the
-- profile row exists by the time we run on INSERT.
DROP TRIGGER IF EXISTS on_auth_user_verified_grant_credits ON auth.users;
CREATE TRIGGER on_auth_user_verified_grant_credits
  AFTER INSERT OR UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.grant_free_credits_on_verify();

-- ===== 8. abuse signal logging + free-tier cluster counting =====
-- Logs the signal, then returns how many distinct free-tier users share the
-- caller's /24 (IPv4) or /64 (IPv6) — or the same device hash — in the last
-- 30 days. Free-tier = never received a paid (non-free, non-refund) credit
-- grant. Callers block when the count exceeds their threshold.
CREATE OR REPLACE FUNCTION public.log_abuse_signal(
  p_user_id UUID,
  p_ip INET,
  p_device_hash TEXT,
  p_signal_type TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cluster INTEGER;
  v_net INET;
BEGIN
  INSERT INTO public.abuse_signals (user_id, ip, device_hash, signal_type)
  VALUES (p_user_id, p_ip, NULLIF(p_device_hash, ''), p_signal_type);

  IF p_ip IS NOT NULL THEN
    v_net := CASE WHEN family(p_ip) = 6
      THEN set_masklen(p_ip, 64)
      ELSE set_masklen(p_ip, 24)
    END;
  END IF;

  SELECT COUNT(DISTINCT s.user_id) INTO v_cluster
  FROM public.abuse_signals s
  WHERE s.created_at > now() - interval '30 days'
    AND (
      (v_net IS NOT NULL AND s.ip IS NOT NULL AND s.ip <<= v_net)
      OR (p_device_hash IS NOT NULL AND p_device_hash <> '' AND s.device_hash = p_device_hash)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.credit_ledger l
      WHERE l.user_id = s.user_id
        AND l.delta > 0
        AND l.reason NOT ILIKE '%free%signup%'
        AND l.reason NOT ILIKE '%refund%'
    );

  RETURN v_cluster;
END;
$$;

REVOKE ALL ON FUNCTION public.log_abuse_signal(UUID, INET, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_abuse_signal(UUID, INET, TEXT, TEXT) TO service_role;

-- ── from supabase/migrations/20260925143500_server_render_worker.sql ──
-- P2: Server render worker support on public.renders.
--
-- Extends the renders table (used by the browser FFmpeg.wasm path) with the
-- fields a server-side native-FFmpeg worker needs: atomic claiming, crash
-- recovery, retries, checkpoints, and graceful cancellation.
--
-- Design:
-- - Worker claims jobs with: UPDATE ... WHERE status='queued' AND
--   (claimed_at IS NULL OR claimed_at < now() - interval '5 minutes')
--   AND attempts < max_attempts ... RETURNING *
--   The 5-minute lease means a crashed worker's jobs become claimable again.
-- - cancel_requested lets the UI ask for graceful cancellation; the worker
--   checks it between stages and marks the job 'cancelled'.
-- - checkpoint stores resumable progress (e.g. completed segment indexes).

ALTER TABLE public.renders
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_by text,
  ADD COLUMN IF NOT EXISTS checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS cancel_requested boolean NOT NULL DEFAULT false;

-- Index for the worker's claim query: only queued, unclaimed-or-expired jobs.
CREATE INDEX IF NOT EXISTS renders_worker_claim_idx
  ON public.renders (status, claimed_at)
  WHERE status = 'queued';

-- Atomic job claim for the server worker. Returns the claimed row, or nothing
-- when no claimable job exists. Uses SELECT ... FOR UPDATE SKIP LOCKED so
-- multiple workers never grab the same job.
CREATE OR REPLACE FUNCTION public.claim_render_job(p_worker_id text, p_lease_seconds integer DEFAULT 300)
RETURNS public.renders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.renders%ROWTYPE;
BEGIN
  SELECT *
  INTO v_job
  FROM public.renders
  WHERE status = 'queued'
    AND engine = 'server_ffmpeg'
    AND attempts < max_attempts
    AND (claimed_at IS NULL OR claimed_at < now() - make_interval(secs => p_lease_seconds))
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.renders
  SET status = 'running',
      stage = 'claimed',
      claimed_at = now(),
      claimed_by = p_worker_id,
      attempts = v_job.attempts + 1,
      render_started_at = COALESCE(v_job.render_started_at, now())
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_render_job(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_render_job(text, integer) TO service_role;

-- Mark a job's heartbeat so long renders don't look crashed.
CREATE OR REPLACE FUNCTION public.heartbeat_render_job(p_job_id uuid, p_worker_id text, p_stage text, p_progress integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.renders
  SET claimed_at = now(),
      stage = p_stage,
      progress = LEAST(GREATEST(p_progress, 0), 100)
  WHERE id = p_job_id
    AND claimed_by = p_worker_id
    AND status = 'running';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.heartbeat_render_job(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_render_job(uuid, text, text, integer) TO service_role;

-- ── from supabase/migrations/20260925150000_research_idea_engine.sql ──
-- P3: Research / Idea Engine tables.
--
-- Top-of-funnel: niche discovery -> outlier analysis -> idea generation ->
-- script brief handoff. All tables are owner-scoped (user_id) with RLS.
--
-- Design:
-- - research_projects: one row per niche exploration. niches JSONB holds the
--   LLM-generated sub-niches, personas, pillars, monetization fit.
-- - outlier_videos: YouTube videos imported for a project, with computed
--   outlier_score (views vs channel median) and LLM-extracted patterns.
-- - video_ideas: generated ideas with lifecycle status
--   (new -> saved/dismissed -> used when handed off to a script project).
-- - youtube_api_cache: 24h cache for YouTube Data API lookups (video +
--   channel stats) so repeated imports don't burn quota. Keyed by a stable
--   cache key; service-role write, owner read via user_id.

CREATE TABLE IF NOT EXISTS public.research_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  topic text NOT NULL,
  language text NOT NULL DEFAULT 'English',
  niches jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.outlier_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.research_projects(id) ON DELETE CASCADE,
  youtube_id text NOT NULL,
  title text NOT NULL DEFAULT '',
  channel_id text NOT NULL DEFAULT '',
  channel_title text NOT NULL DEFAULT '',
  channel_subs bigint NOT NULL DEFAULT 0,
  view_count bigint NOT NULL DEFAULT 0,
  published_at timestamptz,
  outlier_score double precision NOT NULL DEFAULT 1.0,
  patterns jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, youtube_id)
);

CREATE TABLE IF NOT EXISTS public.video_ideas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.research_projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  hook text NOT NULL DEFAULT '',
  angle text NOT NULL DEFAULT '',
  format text NOT NULL DEFAULT 'long',
  difficulty text NOT NULL DEFAULT 'medium',
  safety_flag text NOT NULL DEFAULT 'safe',
  status text NOT NULL DEFAULT 'new',
  project_ref uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.youtube_api_cache (
  cache_key text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS research_projects_user_idx ON public.research_projects (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS outlier_videos_project_idx ON public.outlier_videos (project_id, outlier_score DESC);
CREATE INDEX IF NOT EXISTS video_ideas_project_idx ON public.video_ideas (project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS youtube_api_cache_expiry_idx ON public.youtube_api_cache (expires_at);

-- RLS
ALTER TABLE public.research_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outlier_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.youtube_api_cache ENABLE ROW LEVEL SECURITY;

-- research_projects: owner-only
CREATE POLICY research_projects_owner_select ON public.research_projects
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY research_projects_owner_insert ON public.research_projects
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY research_projects_owner_update ON public.research_projects
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY research_projects_owner_delete ON public.research_projects
  FOR DELETE USING (auth.uid() = user_id);

-- outlier_videos: owner-only
CREATE POLICY outlier_videos_owner_select ON public.outlier_videos
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY outlier_videos_owner_insert ON public.outlier_videos
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY outlier_videos_owner_update ON public.outlier_videos
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY outlier_videos_owner_delete ON public.outlier_videos
  FOR DELETE USING (auth.uid() = user_id);

-- video_ideas: owner-only
CREATE POLICY video_ideas_owner_select ON public.video_ideas
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY video_ideas_owner_insert ON public.video_ideas
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY video_ideas_owner_update ON public.video_ideas
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY video_ideas_owner_delete ON public.video_ideas
  FOR DELETE USING (auth.uid() = user_id);

-- youtube_api_cache: owner-only (server writes via service role, which bypasses RLS)
CREATE POLICY youtube_api_cache_owner_select ON public.youtube_api_cache
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY youtube_api_cache_owner_insert ON public.youtube_api_cache
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY youtube_api_cache_owner_delete ON public.youtube_api_cache
  FOR DELETE USING (auth.uid() = user_id);

-- updated_at maintenance
CREATE OR REPLACE FUNCTION public.touch_research_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_research_projects_touch ON public.research_projects;
CREATE TRIGGER trg_research_projects_touch
  BEFORE UPDATE ON public.research_projects
  FOR EACH ROW EXECUTE FUNCTION public.touch_research_updated_at();

DROP TRIGGER IF EXISTS trg_video_ideas_touch ON public.video_ideas;
CREATE TRIGGER trg_video_ideas_touch
  BEFORE UPDATE ON public.video_ideas
  FOR EACH ROW EXECUTE FUNCTION public.touch_research_updated_at();

-- ── from supabase/migrations/20260925160000_studio_v2.sql ──
-- P4: Studio v2 creative upgrades — characters, music tracks, asset provenance.
--
-- characters: user-defined recurring characters for visual consistency.
-- music_tracks: cached royalty-free tracks from Pixabay Music API.
-- asset_provenance: append-only record of every generated asset's origin.

-- ---------------------------------------------------------------------------
-- characters
-- ---------------------------------------------------------------------------
create table public.characters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '' check (char_length(description) <= 2000),
  reference_image_url text check (char_length(reference_image_url) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.characters enable row level security;

create policy "characters_owner_all"
  on public.characters for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- music_tracks (curated cache; rows are shared catalog, user picks per project)
-- ---------------------------------------------------------------------------
create table public.music_tracks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  artist text not null default 'Unknown artist',
  mood text not null check (mood in ('uplifting', 'tense', 'calm', 'epic', 'playful')),
  provider text not null default 'jamendo',
  provider_track_id text,
  preview_url text,
  download_url text,
  license text not null default 'Creative Commons (see license_url)',
  license_url text,
  duration_secs numeric,
  created_at timestamptz not null default now(),
  unique (provider, provider_track_id)
);

alter table public.music_tracks enable row level security;

-- Read-only catalog for all authenticated users; writes are service-role only
-- (populated by the Jamendo sync server function).
create policy "music_tracks_read_all"
  on public.music_tracks for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- asset_provenance (append-only)
-- ---------------------------------------------------------------------------
create table public.asset_provenance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  scene_id uuid references public.scenes(id) on delete set null,
  kind text not null check (kind in ('image', 'voice', 'music', 'video', 'thumbnail', 'caption')),
  provider text not null,
  model text,
  prompt text,
  seed text,
  license text,
  license_url text,
  cost_credits numeric not null default 0,
  asset_url text,
  created_at timestamptz not null default now()
);

alter table public.asset_provenance enable row level security;

create policy "asset_provenance_owner_read"
  on public.asset_provenance for select
  using (auth.uid() = user_id);

-- Inserts happen service-role side after generation; no direct user writes.
-- (No insert/update/delete policies for authenticated = denied by default.)

create index asset_provenance_scene_idx
  on public.asset_provenance (scene_id, created_at desc);

create index asset_provenance_project_idx
  on public.asset_provenance (project_id, created_at desc);

-- ---------------------------------------------------------------------------
-- scenes: per-scene character + voice override
-- ---------------------------------------------------------------------------
alter table public.scenes
  add column if not exists character_id uuid references public.characters(id) on delete set null,
  add column if not exists voice_id text check (char_length(voice_id) <= 120);

-- ---------------------------------------------------------------------------
-- projects: music selection
-- ---------------------------------------------------------------------------
alter table public.projects
  add column if not exists music_track_id uuid references public.music_tracks(id) on delete set null,
  add column if not exists music_volume numeric not null default 0.15 check (music_volume >= 0 and music_volume <= 1),
  add column if not exists music_ducking boolean not null default true;

-- updated_at triggers
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists characters_touch on public.characters;
create trigger characters_touch
  before update on public.characters
  for each row execute function public.touch_updated_at();

-- ── from supabase/migrations/20260925170000_publish_pipeline.sql ──
-- P5: Thumbnail/SEO studio + YouTube publishing tables.
--
-- thumbnails: AI-generated thumbnail variants per project (16:9 + 9:16),
-- with text overlay specs and a selected variant for publishing.
-- seo_metadata: LLM-generated titles/descriptions/tags per project.
-- publish_jobs: human-approved YouTube publish pipeline with scheduling.
-- NO unattended auto-publishing: status can only reach 'approved' via an
-- explicit user action (enforced in server functions, not just UI).

CREATE TABLE IF NOT EXISTS public.thumbnails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  variant INTEGER NOT NULL DEFAULT 1 CHECK (variant BETWEEN 1 AND 3),
  aspect TEXT NOT NULL DEFAULT '16:9' CHECK (aspect IN ('16:9', '9:16')),
  url TEXT NOT NULL,
  -- final_url: overlay-burned version uploaded by the client (canvas).
  -- Falls back to url when no overlay was applied.
  final_url TEXT,
  text_overlay JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- text_overlay: { headline, font, color, position, fontSize }
  prompt TEXT,
  provider TEXT,
  model TEXT,
  license TEXT NOT NULL DEFAULT 'ai-generated',
  selected BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, variant, aspect)
);

CREATE TABLE IF NOT EXISTS public.seo_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  titles JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- titles: [{ title, score, scoreBreakdown: { length, keyword, curiosity, clarity } }]
  selected_title TEXT,
  description TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  hashtags TEXT[] NOT NULL DEFAULT '{}',
  chapters JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id)
);

-- Publish pipeline state machine:
-- draft -> approved -> scheduled -> uploading -> published
--                    -> failed (from scheduled/uploading)
-- draft -> canceled
-- Only 'approved' requires explicit human action. Nothing auto-advances
-- beyond draft without it.
CREATE TABLE IF NOT EXISTS public.publish_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  video_job_id UUID REFERENCES public.video_jobs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'scheduled', 'uploading', 'published', 'failed', 'canceled')),
  thumbnail_id UUID REFERENCES public.thumbnails(id) ON DELETE SET NULL,
  title TEXT,
  description TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  privacy TEXT NOT NULL DEFAULT 'private' CHECK (privacy IN ('private', 'unlisted', 'public')),
  made_for_kids BOOLEAN,
  scheduled_for TIMESTAMPTZ,
  youtube_video_id TEXT,
  youtube_url TEXT,
  error TEXT,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS thumbnails_project_idx ON public.thumbnails (project_id);
CREATE INDEX IF NOT EXISTS seo_metadata_project_idx ON public.seo_metadata (project_id);
CREATE INDEX IF NOT EXISTS publish_jobs_user_idx ON public.publish_jobs (user_id);
CREATE INDEX IF NOT EXISTS publish_jobs_project_idx ON public.publish_jobs (project_id);
CREATE INDEX IF NOT EXISTS publish_jobs_scheduled_idx ON public.publish_jobs (scheduled_for)
  WHERE status = 'scheduled';

-- RLS: owner-only everywhere
ALTER TABLE public.thumbnails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publish_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY thumbnails_owner ON public.thumbnails
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY seo_metadata_owner ON public.seo_metadata
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY publish_jobs_owner ON public.publish_jobs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- updated_at triggers
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS seo_metadata_touch ON public.seo_metadata;
CREATE TRIGGER seo_metadata_touch
  BEFORE UPDATE ON public.seo_metadata
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS publish_jobs_touch ON public.publish_jobs;
CREATE TRIGGER publish_jobs_touch
  BEFORE UPDATE ON public.publish_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── from supabase/migrations/20260925180000_safety_scores.sql ──
-- P6: Monetization Safety Score.
--
-- safety_scores: versioned, explainable pre-publish monetization risk scores.
-- Every row stores the scorer version so historical scores stay interpretable
-- when the algorithm changes. Owner-only RLS.
--
-- publish_jobs gains two columns for the P6 safety gate:
--   safety_score    — latest score at approval time (null = never scored)
--   safety_override — true when the user explicitly acknowledged a <50 score
-- The server (not the UI) enforces: score < 50 requires safety_override = true.

CREATE TABLE IF NOT EXISTS public.safety_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  band TEXT NOT NULL CHECK (band IN ('safe', 'minor', 'at-risk', 'high-risk')),
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- dimensions: { advertiser: {points, maxPoints}, copyright: {...}, ... }
  issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- issues: [{ dimension, severity, message, suggestion, span }]
  ai_review JSONB,
  -- ai_review: { issues: [...], model, created_at } when deep review was run
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS safety_scores_project_idx
  ON public.safety_scores (project_id, created_at DESC);

ALTER TABLE public.safety_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY safety_scores_owner ON public.safety_scores
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Safety gate columns on the publish pipeline.
ALTER TABLE public.publish_jobs
  ADD COLUMN IF NOT EXISTS safety_score INTEGER CHECK (safety_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS safety_override BOOLEAN NOT NULL DEFAULT false;

-- ── from supabase/migrations/20260925190000_billing_payments.sql ──
-- P7: Billing & payments.
--
-- Tables: plans (catalog), subscriptions (lifecycle), billing_events
-- (raw webhook audit trail, service-role only).
-- Render billing: reserved_minutes + billed_minutes + credits_charged on
-- public.renders for per-minute server-render billing.
-- RPCs: grant_credits_once (idempotent grant), debit_credits_amount_once
-- (idempotent variable-amount debit), finalize_render_billing (reserve ->
-- actual-cost settle for server renders).
--
-- Design notes:
-- - billing_events has a UNIQUE (provider, event_id) constraint. Webhook
--   handlers INSERT ... ON CONFLICT DO NOTHING first; a conflicting insert
--   means the event was already processed -> return early. Grants are ALSO
--   idempotent via grant_credits_once with a deterministic ref_id derived
--   from the provider event id, so replays can never double-grant.
-- - grant_credits_once / debit_credits_amount_once are service_role-only,
--   mirroring the P1 credit RPCs.

-- ===== plans =====
CREATE TABLE IF NOT EXISTS public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('subscription', 'pack')),
  credits_granted integer NOT NULL CHECK (credits_granted > 0),
  interval text NOT NULL DEFAULT 'once' CHECK (interval IN ('once', 'month')),
  price_usd_cents integer CHECK (price_usd_cents IS NULL OR price_usd_cents >= 0),
  price_inr_paise integer CHECK (price_inr_paise IS NULL OR price_inr_paise >= 0),
  stripe_price_id text,
  razorpay_plan_id text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Plans are publicly readable" ON public.plans;
CREATE POLICY "Plans are publicly readable"
  ON public.plans FOR SELECT TO anon, authenticated
  USING (active = true);

-- Seed catalog. Prices are the launch defaults; provider price ids are filled
-- in when Stripe/Razorpay products are created (see docs/BILLING.md).
-- Free tier is not a plan row: it is the 10-credit verified-signup grant (P1).
INSERT INTO public.plans (slug, name, kind, credits_granted, interval, price_usd_cents, price_inr_paise)
VALUES
  ('creator', 'Creator', 'subscription', 60, 'month', 1900, 159900),
  ('studio', 'Studio', 'subscription', 200, 'month', 4900, 409900),
  ('pack_s', 'Starter pack', 'pack', 25, 'once', 900, 74900),
  ('pack_m', 'Growth pack', 'pack', 70, 'once', 1900, 159900),
  ('pack_l', 'Scale pack', 'pack', 200, 'once', 4900, 409900)
ON CONFLICT (slug) DO NOTHING;

-- ===== subscriptions =====
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('stripe', 'razorpay')),
  external_id text NOT NULL,
  plan_slug text NOT NULL REFERENCES public.plans(slug),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'trialing', 'past_due', 'canceled', 'halted', 'paused')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_id)
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read their own subscriptions" ON public.subscriptions;
CREATE POLICY "Users read their own subscriptions"
  ON public.subscriptions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

REVOKE ALL ON public.subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;

-- ===== billing_events (webhook audit trail, service-role only) =====
CREATE TABLE IF NOT EXISTS public.billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('stripe', 'razorpay')),
  event_id text NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);

ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.billing_events TO service_role;

-- ===== renders: server-render billing columns =====
ALTER TABLE public.renders
  ADD COLUMN IF NOT EXISTS reserved_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS billed_minutes integer,
  ADD COLUMN IF NOT EXISTS credits_charged integer NOT NULL DEFAULT 0;

-- ===== idempotent variable-amount grant =====
-- Same race-safe pattern as the P1 RPCs: a second call with the same
-- p_ref_id is a no-op returning the current balance.
CREATE OR REPLACE FUNCTION public.grant_credits_once(
  p_user_id UUID,
  p_amount INTEGER,
  p_reason TEXT,
  p_ref_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credits INTEGER;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  SELECT credits INTO v_credits
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND';
  END IF;

  IF p_ref_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.credit_ledger
    WHERE user_id = p_user_id AND ref_id = p_ref_id AND delta > 0
  ) THEN
    RETURN v_credits;
  END IF;

  UPDATE public.profiles
  SET credits = credits + p_amount
  WHERE id = p_user_id
  RETURNING credits INTO v_credits;

  INSERT INTO public.credit_ledger (user_id, delta, reason, ref_id)
  VALUES (p_user_id, p_amount, p_reason, p_ref_id);

  RETURN v_credits;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_credits_once(UUID, INTEGER, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_credits_once(UUID, INTEGER, TEXT, UUID) TO service_role;

-- ===== idempotent variable-amount debit =====
CREATE OR REPLACE FUNCTION public.debit_credits_amount_once(
  p_user_id UUID,
  p_amount INTEGER,
  p_reason TEXT,
  p_ref_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credits INTEGER;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  SELECT credits INTO v_credits
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND';
  END IF;

  IF p_ref_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.credit_ledger
    WHERE user_id = p_user_id AND ref_id = p_ref_id AND delta < 0
  ) THEN
    RETURN v_credits;
  END IF;

  IF v_credits < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_CREDITS';
  END IF;

  UPDATE public.profiles
  SET credits = credits - p_amount
  WHERE id = p_user_id
  RETURNING credits INTO v_credits;

  INSERT INTO public.credit_ledger (user_id, delta, reason, ref_id)
  VALUES (p_user_id, -p_amount, p_reason, p_ref_id);

  RETURN v_credits;
END;
$$;

REVOKE ALL ON FUNCTION public.debit_credits_amount_once(UUID, INTEGER, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debit_credits_amount_once(UUID, INTEGER, TEXT, UUID) TO service_role;

-- ===== finalize server-render billing (reserve -> actual-cost) =====
-- Called by the render worker (service role) when a server render finishes.
-- Settles the reserved minutes against the actual render duration:
--   actual > reserved -> debit the difference
--   actual < reserved -> refund the difference
-- Idempotent: a second call with the same render id is a no-op.
CREATE OR REPLACE FUNCTION public.finalize_render_billing(p_render_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_render public.renders%ROWTYPE;
  v_actual_minutes INTEGER;
  v_diff INTEGER;
  v_credits INTEGER;
BEGIN
  SELECT * INTO v_render FROM public.renders WHERE id = p_render_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RENDER_NOT_FOUND';
  END IF;

  -- Already finalized -> no-op.
  IF v_render.billed_minutes IS NOT NULL THEN
    RETURN jsonb_build_object(
      'render_id', p_render_id,
      'billed_minutes', v_render.billed_minutes,
      'credits_charged', v_render.credits_charged,
      'already_finalized', true
    );
  END IF;

  IF v_render.render_started_at IS NULL OR v_render.render_completed_at IS NULL THEN
    RAISE EXCEPTION 'RENDER_NOT_COMPLETE';
  END IF;

  -- Started minutes, minimum 1.
  v_actual_minutes := GREATEST(
    1,
    CEIL(EXTRACT(EPOCH FROM (v_render.render_completed_at - v_render.render_started_at)) / 60.0)::INTEGER
  );

  v_diff := v_actual_minutes - COALESCE(v_render.reserved_minutes, 0);

  IF v_diff > 0 THEN
    -- Ref is NULL: idempotency is provided by the outer billed_minutes guard
    -- (the reserve debit at enqueue time uses ref_id = p_render_id, so the
    -- settle must not reuse it — the reserve's ledger row would shadow it).
    PERFORM public.debit_credits_amount_once(
      v_render.user_id, v_diff,
      'Server render overage (' || v_actual_minutes || ' min)',
      NULL
    );
  ELSIF v_diff < 0 THEN
    PERFORM public.grant_credits_once(
      v_render.user_id, -v_diff,
      'Server render refund (reserved ' || v_render.reserved_minutes || ' min, used ' || v_actual_minutes || ')',
      NULL
    );
  END IF;

  SELECT credits INTO v_credits FROM public.profiles WHERE id = v_render.user_id;

  UPDATE public.renders
  SET billed_minutes = v_actual_minutes,
      credits_charged = COALESCE(reserved_minutes, 0) + v_diff,
      updated_at = now()
  WHERE id = p_render_id;

  RETURN jsonb_build_object(
    'render_id', p_render_id,
    'billed_minutes', v_actual_minutes,
    'credits_charged', COALESCE(v_render.reserved_minutes, 0) + v_diff,
    'balance', v_credits
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_render_billing(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_render_billing(UUID) TO service_role;

-- ── from supabase/migrations/20260925200000_analytics_learning.sql ──
-- P8: Analytics & learning loop tables.
--
-- video_analytics: per-video metric snapshots (24h / 7d post-publish cadence).
--   One row per (youtube_video_id, snapshot_date) — deduped by UNIQUE.
-- channel_stats: daily channel-level snapshot per user.
-- learning_insights: derived insights feeding back into P3 (outliers, patterns,
--   idea boosts) and P6 (safety validation). All owner-scoped.

CREATE TABLE IF NOT EXISTS public.video_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  publish_job_id UUID REFERENCES public.publish_jobs(id) ON DELETE SET NULL,
  youtube_video_id TEXT NOT NULL,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  snapshot_date DATE NOT NULL DEFAULT (now()::date),
  age_days INTEGER NOT NULL DEFAULT 0,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (youtube_video_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS video_analytics_user_idx ON public.video_analytics (user_id);
CREATE INDEX IF NOT EXISTS video_analytics_video_idx ON public.video_analytics (youtube_video_id);

CREATE TABLE IF NOT EXISTS public.channel_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  snapshot_date DATE NOT NULL DEFAULT (now()::date),
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS channel_stats_user_idx ON public.channel_stats (user_id);

CREATE TABLE IF NOT EXISTS public.learning_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN (
    'own_outlier',        -- own video outperformed channel median -> P3 outlier
    'pattern',            -- hook/title/style correlated with CTR (correlation, not causation)
    'idea_boost',         -- pattern weight applied to P3 idea generation
    'safety_validation'   -- actual monetization status vs P6 score
  )),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS learning_insights_user_idx ON public.learning_insights (user_id);
CREATE INDEX IF NOT EXISTS learning_insights_kind_idx ON public.learning_insights (user_id, kind);

ALTER TABLE public.video_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS video_analytics_owner ON public.video_analytics;
CREATE POLICY video_analytics_owner ON public.video_analytics
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS channel_stats_owner ON public.channel_stats;
CREATE POLICY channel_stats_owner ON public.channel_stats
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS learning_insights_owner ON public.learning_insights;
CREATE POLICY learning_insights_owner ON public.learning_insights
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- updated_at touch triggers
DROP TRIGGER IF EXISTS video_analytics_touch ON public.video_analytics;
DROP TRIGGER IF EXISTS channel_stats_touch ON public.channel_stats;

-- ── from supabase/migrations/20260925210000_outlier_source.sql ──
-- P8 follow-up: tag outlier_videos with a source so the learning loop can
-- distinguish imported competitor outliers from the user's own channel winners.

ALTER TABLE public.outlier_videos
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'import'
  CHECK (source IN ('import', 'own'));

CREATE INDEX IF NOT EXISTS outlier_videos_source_idx
  ON public.outlier_videos (user_id, source, outlier_score DESC);

-- P8: record when a video actually went live on YouTube so the analytics
-- scheduler can compute 24h / 7d snapshot windows.
ALTER TABLE public.publish_jobs
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

-- ── from supabase/migrations/20260925220000_referrals.sql ──
-- P9: Referral program
-- Invite links /r/{code}; 5 credits to each side when the invitee verifies
-- email. Anti-abuse: referral rows are claimed at most once; the reward is
-- granted through grant_credits_once with a deterministic ref so replays can
-- never double-grant.

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  referrer_id uuid not null references auth.users (id) on delete cascade,
  invitee_id uuid references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'verified', 'rewarded')),
  device_hash text,
  ip_prefix text,
  created_at timestamptz not null default now(),
  rewarded_at timestamptz
);

create index referrals_referrer_idx on public.referrals (referrer_id);
create index referrals_invitee_idx on public.referrals (invitee_id);
create index referrals_code_idx on public.referrals (code);

alter table public.referrals enable row level security;

-- Referrers can read their own referrals; nobody else can.
create policy "owner read own referrals"
  on public.referrals for select
  using (auth.uid() = referrer_id);

-- Rows are created/updated by the service role only (server functions).
-- No insert/update/delete policies for authenticated users.

-- ── from supabase/migrations/20260925234000_referrals_unique_pair.sql ──
-- P9: idempotent referral submission needs a unique key on (referrer_id, invitee_id).
-- Rows without an invitee (the referrer's own shareable-link placeholder) are
-- excluded so one placeholder per user is still possible.

alter table public.referrals
  add constraint referrals_referrer_invitee_key
  unique nulls not distinct (referrer_id, invitee_id);

-- Step 3: Fix foreign keys on AI-added columns of pre-existing tables.
-- The AI added music_track_id/character_id as plain UUIDs without FKs.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_music_track_id_fkey') THEN
    ALTER TABLE public.projects ADD CONSTRAINT projects_music_track_id_fkey
      FOREIGN KEY (music_track_id) REFERENCES public.music_tracks(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scenes_character_id_fkey') THEN
    ALTER TABLE public.scenes ADD CONSTRAINT scenes_character_id_fkey
      FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE SET NULL;
  END IF;
END $$;
