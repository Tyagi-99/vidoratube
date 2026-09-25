-- Sprint 0: per-finished-minute credit model.
--
-- 1) New atomic RPCs for minute-based charging. The old per-render RPCs
--    (debit_credits_for_job, refund_credits, ...) are left untouched — no
--    existing rows are edited or deleted by this migration.
-- 2) One-time conversion of legacy credits: 1 old credit -> 1 finished minute,
--    recorded as APPEND-ONLY ledger entries (delta = 0, purely documentary).
--    The balance number does not change (the conversion is 1:1); only the
--    unit's meaning changes. Idempotent: re-running inserts nothing new.
--
-- Apply via Supabase SQL editor or `supabase db push`.
-- These functions are service_role-only; server functions validate the
-- caller's JWT before invoking them.

-- Debit N minutes for a job. Raises INSUFFICIENT_CREDITS when the balance is
-- too low. Idempotent per p_ref_id: a repeat call with the same ref is a
-- no-op returning the current balance, so retries can never double-charge.
CREATE OR REPLACE FUNCTION public.debit_credits_for_minutes(
  p_user_id UUID,
  p_minutes INTEGER,
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
  IF p_minutes IS NULL OR p_minutes < 1 THEN
    RAISE EXCEPTION 'INVALID_MINUTES';
  END IF;

  -- Lock the profile row first so concurrent debits serialize.
  UPDATE public.profiles
    SET credits = credits
    WHERE id = p_user_id
    RETURNING credits INTO v_credits;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND';
  END IF;

  -- Idempotency: same ref already debited -> no-op.
  IF p_ref_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.credit_ledger
    WHERE user_id = p_user_id AND ref_id = p_ref_id AND delta < 0
  ) THEN
    RETURN v_credits;
  END IF;

  UPDATE public.profiles
    SET credits = credits - p_minutes
    WHERE id = p_user_id AND credits >= p_minutes
    RETURNING credits INTO v_credits;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSUFFICIENT_CREDITS';
  END IF;

  INSERT INTO public.credit_ledger (user_id, delta, reason, ref_id)
    VALUES (p_user_id, -p_minutes, p_reason, p_ref_id);

  RETURN v_credits;
END;
$$;

-- Refund N minutes for a job (failed renders). Idempotent per p_ref_id:
-- if a refund for the ref already exists the call is a no-op.
CREATE OR REPLACE FUNCTION public.refund_credits_for_minutes(
  p_user_id UUID,
  p_minutes INTEGER,
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
  IF p_minutes IS NULL OR p_minutes < 1 THEN
    RAISE EXCEPTION 'INVALID_MINUTES';
  END IF;

  UPDATE public.profiles
    SET credits = credits
    WHERE id = p_user_id
    RETURNING credits INTO v_credits;

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
    SET credits = credits + p_minutes
    WHERE id = p_user_id
    RETURNING credits INTO v_credits;

  INSERT INTO public.credit_ledger (user_id, delta, reason, ref_id)
    VALUES (p_user_id, p_minutes, p_reason, p_ref_id);

  RETURN v_credits;
END;
$$;

-- One-time conversion: 1 legacy credit -> 1 finished minute (1:1).
-- Append-only documentary entries (delta = 0); balances are NOT touched and
-- no existing rows are modified. Safe to re-run. Reason is exactly
-- 'migration_per_minute' (investor-required wording).
INSERT INTO public.credit_ledger (user_id, delta, reason)
SELECT
  p.id,
  0,
  'migration_per_minute'
FROM public.profiles p
WHERE p.credits > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.credit_ledger l
    WHERE l.user_id = p.id AND l.reason LIKE 'migration_per_minute%'
  );
