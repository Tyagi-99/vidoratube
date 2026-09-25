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
