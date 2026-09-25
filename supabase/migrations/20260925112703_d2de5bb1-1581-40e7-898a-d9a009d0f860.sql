ALTER TABLE public.credit_ledger ADD COLUMN IF NOT EXISTS ref_id UUID;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS free_credits_granted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'en';
ALTER TABLE public.video_jobs ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE public.renders
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_by text,
  ADD COLUMN IF NOT EXISTS checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS cancel_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reserved_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS billed_minutes integer,
  ADD COLUMN IF NOT EXISTS credits_charged integer NOT NULL DEFAULT 0;
ALTER TABLE public.outlier_videos
  ADD COLUMN IF NOT EXISTS channel_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS channel_subs bigint NOT NULL DEFAULT 0;
ALTER TABLE public.video_ideas
  ADD COLUMN IF NOT EXISTS project_ref uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.thumbnails
  ADD COLUMN IF NOT EXISTS variant INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS aspect TEXT NOT NULL DEFAULT '16:9',
  ADD COLUMN IF NOT EXISTS url TEXT,
  ADD COLUMN IF NOT EXISTS final_url TEXT,
  ADD COLUMN IF NOT EXISTS prompt TEXT,
  ADD COLUMN IF NOT EXISTS license TEXT NOT NULL DEFAULT 'ai-generated';
ALTER TABLE public.safety_scores ADD COLUMN IF NOT EXISTS ai_review JSONB;
ALTER TABLE public.publish_jobs
  ADD COLUMN IF NOT EXISTS safety_score INTEGER,
  ADD COLUMN IF NOT EXISTS safety_override BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS kind text,
  ADD COLUMN IF NOT EXISTS credits_granted integer,
  ADD COLUMN IF NOT EXISTS interval text NOT NULL DEFAULT 'once',
  ADD COLUMN IF NOT EXISTS price_usd_cents integer,
  ADD COLUMN IF NOT EXISTS price_inr_paise integer,
  ADD COLUMN IF NOT EXISTS stripe_price_id text,
  ADD COLUMN IF NOT EXISTS razorpay_plan_id text,
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE public.billing_events
  ADD COLUMN IF NOT EXISTS type text,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz;
ALTER TABLE public.video_analytics ADD COLUMN IF NOT EXISTS snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.channel_stats ADD COLUMN IF NOT EXISTS snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.outlier_videos ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'import';
ALTER TABLE public.referrals
  ADD COLUMN IF NOT EXISTS invitee_id uuid,
  ADD COLUMN IF NOT EXISTS device_hash text,
  ADD COLUMN IF NOT EXISTS ip_prefix text,
  ADD COLUMN IF NOT EXISTS rewarded_at timestamptz;

CREATE TABLE IF NOT EXISTS public.disposable_email_domains (
  domain TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.disposable_email_domains TO anon, authenticated;
GRANT ALL ON public.disposable_email_domains TO service_role;
ALTER TABLE public.disposable_email_domains ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Disposable domains are public" ON public.disposable_email_domains;
CREATE POLICY "Disposable domains are public" ON public.disposable_email_domains
  FOR SELECT TO anon, authenticated USING (domain IS NOT NULL);

CREATE TABLE IF NOT EXISTS public.abuse_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  ip INET,
  device_hash TEXT,
  signal_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.abuse_signals TO authenticated;
GRANT ALL ON public.abuse_signals TO service_role;
ALTER TABLE public.abuse_signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read abuse signals" ON public.abuse_signals;
CREATE POLICY "Admins read abuse signals" ON public.abuse_signals
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS abuse_signals_ip_idx ON public.abuse_signals (ip);
CREATE INDEX IF NOT EXISTS abuse_signals_device_idx ON public.abuse_signals (device_hash);
CREATE INDEX IF NOT EXISTS abuse_signals_created_idx ON public.abuse_signals (created_at);

CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  bucket_key TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  hit_count INTEGER NOT NULL DEFAULT 0
);
GRANT ALL ON public.rate_limit_buckets TO service_role;
ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['disposable_email_domains','abuse_signals','rate_limit_buckets'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "No guest sessions" ON public.%I', t);
    EXECUTE format('CREATE POLICY "No guest sessions" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (COALESCE((auth.jwt() ->> ''is_anonymous'')::boolean, false) IS NOT TRUE) WITH CHECK (COALESCE((auth.jwt() ->> ''is_anonymous'')::boolean, false) IS NOT TRUE)', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.debit_credits_for_job(p_user_id UUID, p_reason TEXT, p_job_id UUID DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_credits INTEGER;
BEGIN
  UPDATE public.profiles SET credits = credits - 1 WHERE id = p_user_id AND credits >= 1 RETURNING credits INTO v_credits;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSUFFICIENT_CREDITS'; END IF;
  INSERT INTO public.credit_ledger (user_id, delta, reason, ref_id) VALUES (p_user_id, -1, p_reason, p_job_id);
  RETURN v_credits;
END; $$;

CREATE OR REPLACE FUNCTION public.refund_credits(p_user_id UUID, p_reason TEXT, p_job_id UUID DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_credits INTEGER;
BEGIN
  SELECT credits INTO v_credits FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;
  IF p_job_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.credit_ledger WHERE user_id = p_user_id AND ref_id = p_job_id AND delta > 0) THEN
    RETURN v_credits;
  END IF;
  UPDATE public.profiles SET credits = credits + 1 WHERE id = p_user_id RETURNING credits INTO v_credits;
  INSERT INTO public.credit_ledger (user_id, delta, reason, ref_id) VALUES (p_user_id, 1, p_reason, p_job_id);
  RETURN v_credits;
END; $$;

CREATE OR REPLACE FUNCTION public.adjust_credits(p_user_id UUID, p_delta INTEGER, p_reason TEXT, p_admin_id UUID DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_credits INTEGER;
BEGIN
  UPDATE public.profiles SET credits = GREATEST(0, credits + p_delta) WHERE id = p_user_id RETURNING credits INTO v_credits;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;
  INSERT INTO public.credit_ledger (user_id, delta, reason, admin_id) VALUES (p_user_id, p_delta, p_reason, p_admin_id);
  RETURN v_credits;
END; $$;

CREATE OR REPLACE FUNCTION public.check_rate_limit(p_key TEXT, p_max INTEGER, p_window_seconds INTEGER)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_window_start TIMESTAMPTZ; v_count INTEGER; v_cutoff TIMESTAMPTZ;
BEGIN
  IF p_max < 1 OR p_window_seconds < 1 THEN RAISE EXCEPTION 'INVALID_RATE_LIMIT_ARGS'; END IF;
  v_cutoff := now() - make_interval(secs => p_window_seconds);
  INSERT INTO public.rate_limit_buckets (bucket_key, window_start, hit_count) VALUES (p_key, now(), 0) ON CONFLICT (bucket_key) DO NOTHING;
  SELECT window_start, hit_count INTO v_window_start, v_count FROM public.rate_limit_buckets WHERE bucket_key = p_key FOR UPDATE;
  IF v_window_start < v_cutoff THEN
    UPDATE public.rate_limit_buckets SET window_start = now(), hit_count = 1 WHERE bucket_key = p_key;
    RETURN TRUE;
  END IF;
  IF v_count >= p_max THEN RETURN FALSE; END IF;
  UPDATE public.rate_limit_buckets SET hit_count = hit_count + 1 WHERE bucket_key = p_key;
  RETURN TRUE;
END; $$;

CREATE OR REPLACE FUNCTION public.debit_credits_for_job_once(p_user_id UUID, p_reason TEXT, p_job_id UUID DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_credits INTEGER;
BEGIN
  SELECT credits INTO v_credits FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;
  IF p_job_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.credit_ledger WHERE user_id = p_user_id AND ref_id = p_job_id AND delta < 0) THEN
    RETURN v_credits;
  END IF;
  IF v_credits < 1 THEN RAISE EXCEPTION 'INSUFFICIENT_CREDITS'; END IF;
  UPDATE public.profiles SET credits = credits - 1 WHERE id = p_user_id RETURNING credits INTO v_credits;
  INSERT INTO public.credit_ledger (user_id, delta, reason, ref_id) VALUES (p_user_id, -1, p_reason, p_job_id);
  RETURN v_credits;
END; $$;

CREATE OR REPLACE FUNCTION public.log_abuse_signal(p_user_id UUID, p_ip INET, p_device_hash TEXT, p_signal_type TEXT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cluster INTEGER; v_net INET;
BEGIN
  INSERT INTO public.abuse_signals (user_id, ip, device_hash, signal_type) VALUES (p_user_id, p_ip, NULLIF(p_device_hash, ''), p_signal_type);
  IF p_ip IS NOT NULL THEN
    v_net := CASE WHEN family(p_ip) = 6 THEN set_masklen(p_ip, 64) ELSE set_masklen(p_ip, 24) END;
  END IF;
  SELECT COUNT(DISTINCT s.user_id) INTO v_cluster FROM public.abuse_signals s
  WHERE s.created_at > now() - interval '30 days'
    AND ((v_net IS NOT NULL AND s.ip IS NOT NULL AND s.ip <<= v_net)
      OR (p_device_hash IS NOT NULL AND p_device_hash <> '' AND s.device_hash = p_device_hash))
    AND NOT EXISTS (SELECT 1 FROM public.credit_ledger l WHERE l.user_id = s.user_id AND l.delta > 0
      AND l.reason NOT ILIKE '%free%signup%' AND l.reason NOT ILIKE '%refund%');
  RETURN v_cluster;
END; $$;

CREATE OR REPLACE FUNCTION public.grant_credits_once(p_user_id UUID, p_amount INTEGER, p_reason TEXT, p_ref_id UUID DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_credits INTEGER;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  SELECT credits INTO v_credits FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;
  IF p_ref_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.credit_ledger WHERE user_id = p_user_id AND ref_id = p_ref_id AND delta > 0) THEN
    RETURN v_credits;
  END IF;
  UPDATE public.profiles SET credits = credits + p_amount WHERE id = p_user_id RETURNING credits INTO v_credits;
  INSERT INTO public.credit_ledger (user_id, delta, reason, ref_id) VALUES (p_user_id, p_amount, p_reason, p_ref_id);
  RETURN v_credits;
END; $$;

CREATE OR REPLACE FUNCTION public.debit_credits_amount_once(p_user_id UUID, p_amount INTEGER, p_reason TEXT, p_ref_id UUID DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_credits INTEGER;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  SELECT credits INTO v_credits FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;
  IF p_ref_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.credit_ledger WHERE user_id = p_user_id AND ref_id = p_ref_id AND delta < 0) THEN
    RETURN v_credits;
  END IF;
  IF v_credits < p_amount THEN RAISE EXCEPTION 'INSUFFICIENT_CREDITS'; END IF;
  UPDATE public.profiles SET credits = credits - p_amount WHERE id = p_user_id RETURNING credits INTO v_credits;
  INSERT INTO public.credit_ledger (user_id, delta, reason, ref_id) VALUES (p_user_id, -p_amount, p_reason, p_ref_id);
  RETURN v_credits;
END; $$;

REVOKE ALL ON FUNCTION public.debit_credits_for_job(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_credits(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.adjust_credits(UUID, INTEGER, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.debit_credits_for_job_once(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_abuse_signal(UUID, INET, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_credits_once(UUID, INTEGER, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.debit_credits_amount_once(UUID, INTEGER, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debit_credits_for_job(UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_credits(UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.adjust_credits(UUID, INTEGER, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.debit_credits_for_job_once(UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.log_abuse_signal(UUID, INET, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_credits_once(UUID, INTEGER, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.debit_credits_amount_once(UUID, INTEGER, TEXT, UUID) TO service_role;