-- Fix: refund_credits_for_minutes must never mint credits without a matching debit.
--
-- The original version (20260925194000) granted p_minutes on first call as long
-- as no positive refund row existed yet — even when no debit had ever happened
-- for that ref. The render catch block calls refundMinutesForJob() even when
-- planning/debit failed before any charge, so this was a real money bug:
-- failed-before-charge jobs would have received free credits.
--
-- New behavior (non-destructive, forward-only):
--   1. If a positive refund already exists for (user, ref) -> no-op (idempotent).
--   2. Else, look up the actual debited amount: -SUM(delta) over negative
--      ledger rows for (user, ref). No debit (or ref NULL) -> no-op, balance
--      untouched. A job that was never charged can never be refunded.
--   3. Otherwise credit back the ACTUAL debited amount, capped at p_minutes
--      (the caller can never inflate the refund).
--
-- Also normalizes the one-time conversion rows to the exact investor-required
-- reason 'migration_per_minute' (the original migration wrote a longer
-- 'migration_per_minute: converted ...' string), and fixes the original
-- migration's INSERT for fresh applies.

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
  v_debited INTEGER;
BEGIN
  IF p_minutes IS NULL OR p_minutes < 1 THEN
    RAISE EXCEPTION 'INVALID_MINUTES';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_USER';
  END IF;

  -- 1. Idempotency: a positive refund for this ref already exists -> no-op.
  IF p_ref_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.credit_ledger
    WHERE user_id = p_user_id AND ref_id = p_ref_id AND delta > 0
  ) THEN
    SELECT credits INTO v_credits FROM public.profiles WHERE id = p_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PROFILE_NOT_FOUND';
    END IF;
    RETURN v_credits;
  END IF;

  -- 2. Money safety: refund only what was actually debited for this ref.
  --    No matching debit (or no ref at all) -> no-op. Never mints credits.
  SELECT -SUM(delta) INTO v_debited
  FROM public.credit_ledger
  WHERE user_id = p_user_id
    AND ref_id IS NOT DISTINCT FROM p_ref_id
    AND delta < 0;

  IF v_debited IS NULL OR v_debited < 1 OR p_ref_id IS NULL THEN
    SELECT credits INTO v_credits FROM public.profiles WHERE id = p_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PROFILE_NOT_FOUND';
    END IF;
    RETURN v_credits;
  END IF;

  -- 3. Refund the actual debited amount; the caller cannot inflate it.
  v_debited := LEAST(v_debited, p_minutes);

  UPDATE public.profiles
    SET credits = credits + v_debited
    WHERE id = p_user_id
    RETURNING credits INTO v_credits;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND';
  END IF;

  INSERT INTO public.credit_ledger (user_id, delta, reason, ref_id)
    VALUES (p_user_id, v_debited, p_reason, p_ref_id);

  RETURN v_credits;
END;
$$;

-- Normalize conversion rows to the exact required reason (no-op on fresh DBs).
-- Only touches rows created by the per-minute conversion itself.
UPDATE public.credit_ledger
SET reason = 'migration_per_minute'
WHERE reason LIKE 'migration_per_minute:%';
