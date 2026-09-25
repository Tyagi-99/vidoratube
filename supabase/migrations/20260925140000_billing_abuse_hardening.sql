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
