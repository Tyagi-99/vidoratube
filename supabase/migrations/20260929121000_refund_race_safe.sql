-- P0-2: make refund_credits_for_minutes race-safe.
--
-- The idempotency EXISTS check ran BEFORE any row lock was taken: two
-- concurrent refunds for the same (user_id, ref_id) could both pass the check
-- at READ COMMITTED, both compute the same debit, and both refund — 2x the
-- charged amount. The sibling debit/grant functions all take SELECT ... FOR
-- UPDATE before their idempotency checks; this function was the outlier.
--
-- Forward-only: CREATE OR REPLACE + a partial unique index that enforces the
-- function's own idempotency invariant (one positive 'Refund:' row per
-- (user_id, ref_id)), so the race is impossible even if locking regresses.
-- The index predicate is scoped to reasons starting with 'Refund:' — the
-- family of reasons refundMinutesForJob() writes — so admin adjustments,
-- grants, and conversion rows are untouched.

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

  -- P0-2: take the profile row lock FIRST, before the idempotency check.
  -- Concurrent refunds for the same user now serialize here, so the EXISTS
  -- check below always sees the other transaction's committed rows.
  SELECT credits INTO v_credits FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND';
  END IF;

  -- 1. Idempotency: a positive refund for this ref already exists -> no-op.
  IF p_ref_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.credit_ledger
    WHERE user_id = p_user_id AND ref_id = p_ref_id AND delta > 0
  ) THEN
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
    RETURN v_credits;
  END IF;

  -- 3. Refund the actual debited amount; the caller cannot inflate it.
  v_debited := LEAST(v_debited, p_minutes);

  UPDATE public.profiles
    SET credits = credits + v_debited
    WHERE id = p_user_id
    RETURNING credits INTO v_credits;

  INSERT INTO public.credit_ledger (user_id, delta, reason, ref_id)
    VALUES (p_user_id, v_debited, p_reason, p_ref_id);

  RETURN v_credits;
END;
$$;

-- Defense in depth: the function's idempotency contract as a hard constraint.
-- Scoped to the 'Refund:' reason family that refundMinutesForJob() writes.
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_one_refund_per_ref
  ON public.credit_ledger (user_id, ref_id)
  WHERE delta > 0 AND ref_id IS NOT NULL AND reason LIKE 'Refund:%';

-- Re-assert the P0-1 posture (safe to repeat: idempotent GRANT/REVOKE).
REVOKE ALL ON FUNCTION public.refund_credits_for_minutes(UUID, INTEGER, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_credits_for_minutes(UUID, INTEGER, TEXT, UUID)
  TO service_role;
