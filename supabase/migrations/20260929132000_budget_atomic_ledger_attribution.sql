-- P1-5 (2026-09-29 audit): make budget enforcement atomic and ledger-aware.
--
-- Two defects:
-- 1. Month-to-date spend was computed from generation_jobs.cost_actual_credits
--    only, so voice/render/video-job debits that touch just the ledger were
--    invisible to workspace/project caps.
-- 2. The preflight budget check and the eventual debit are separate
--    transactions, so concurrent jobs can both pass a cap.
--
-- Fix:
-- a. credit_ledger gains nullable workspace_id / project_id attribution
--    columns (indexed). Debit RPCs accept them and write them on the row.
-- b. The debit RPCs enforce caps ATOMICALLY inside the debit transaction:
--    the budget row is locked FOR UPDATE, month-to-date attributed spend is
--    summed, and the debit raises BUDGET_EXCEEDED instead of proceeding.
--    The preflight check remains as a UX fast-path; the RPC is the backstop.
-- c. getMonthToDateSpend (TS) now sums attributed ledger debits, keeping the
--    generation_jobs fallback only for jobs with no attributed debit
--    (no double-counting).
--
-- Callers that know their scope pass it; NULL scope = uncapped, as before.

ALTER TABLE public.credit_ledger
  ADD COLUMN IF NOT EXISTS workspace_id UUID NULL,
  ADD COLUMN IF NOT EXISTS project_id UUID NULL;

CREATE INDEX IF NOT EXISTS credit_ledger_workspace_month_idx
  ON public.credit_ledger (workspace_id, created_at) WHERE delta < 0 AND workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS credit_ledger_project_month_idx
  ON public.credit_ledger (project_id, created_at) WHERE delta < 0 AND project_id IS NOT NULL;

-- Replace the 4-arg debit RPCs with 6-arg versions (new params defaulted, so
-- existing 4-arg calls keep working). The old signatures are dropped first;
-- P0-1's REVOKE/GRANT posture is re-asserted below for the new signatures.
DROP FUNCTION IF EXISTS public.debit_credits_for_minutes(UUID, INTEGER, TEXT, UUID);
DROP FUNCTION IF EXISTS public.debit_credits_amount_once(UUID, INTEGER, TEXT, UUID);

CREATE FUNCTION public.debit_credits_for_minutes(
  p_user_id UUID,
  p_minutes INTEGER,
  p_reason TEXT,
  p_ref_id UUID DEFAULT NULL,
  p_workspace_id UUID DEFAULT NULL,
  p_project_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credits INTEGER;
  v_cap INTEGER;
  v_spent INTEGER;
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

  -- P1-5: atomic budget enforcement. The budget row lock serializes
  -- concurrent debits even across different users of one workspace.
  IF p_workspace_id IS NOT NULL THEN
    SELECT monthly_credit_cap INTO v_cap
    FROM public.workspace_budgets
    WHERE workspace_id = p_workspace_id
    FOR UPDATE;
    IF v_cap IS NOT NULL THEN
      SELECT COALESCE(-SUM(delta), 0) INTO v_spent
      FROM public.credit_ledger
      WHERE workspace_id = p_workspace_id
        AND delta < 0
        AND created_at >= date_trunc('month', now());
      IF v_spent + p_minutes > v_cap THEN
        RAISE EXCEPTION 'WORKSPACE_BUDGET_EXCEEDED';
      END IF;
    END IF;
  END IF;

  IF p_project_id IS NOT NULL THEN
    SELECT credit_cap INTO v_cap
    FROM public.project_budgets
    WHERE project_id = p_project_id
    FOR UPDATE;
    IF v_cap IS NOT NULL THEN
      SELECT COALESCE(-SUM(delta), 0) INTO v_spent
      FROM public.credit_ledger
      WHERE project_id = p_project_id
        AND delta < 0
        AND created_at >= date_trunc('month', now());
      IF v_spent + p_minutes > v_cap THEN
        RAISE EXCEPTION 'PROJECT_BUDGET_EXCEEDED';
      END IF;
    END IF;
  END IF;

  UPDATE public.profiles
    SET credits = credits - p_minutes
    WHERE id = p_user_id AND credits >= p_minutes
    RETURNING credits INTO v_credits;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSUFFICIENT_CREDITS';
  END IF;

  INSERT INTO public.credit_ledger (user_id, delta, reason, ref_id, workspace_id, project_id)
    VALUES (p_user_id, -p_minutes, p_reason, p_ref_id, p_workspace_id, p_project_id);

  RETURN v_credits;
END;
$$;

CREATE FUNCTION public.debit_credits_amount_once(
  p_user_id UUID,
  p_amount INTEGER,
  p_reason TEXT,
  p_ref_id UUID DEFAULT NULL,
  p_workspace_id UUID DEFAULT NULL,
  p_project_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credits INTEGER;
  v_cap INTEGER;
  v_spent INTEGER;
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

  -- P1-5: atomic budget enforcement (same as debit_credits_for_minutes).
  IF p_workspace_id IS NOT NULL THEN
    SELECT monthly_credit_cap INTO v_cap
    FROM public.workspace_budgets
    WHERE workspace_id = p_workspace_id
    FOR UPDATE;
    IF v_cap IS NOT NULL THEN
      SELECT COALESCE(-SUM(delta), 0) INTO v_spent
      FROM public.credit_ledger
      WHERE workspace_id = p_workspace_id
        AND delta < 0
        AND created_at >= date_trunc('month', now());
      IF v_spent + p_amount > v_cap THEN
        RAISE EXCEPTION 'WORKSPACE_BUDGET_EXCEEDED';
      END IF;
    END IF;
  END IF;

  IF p_project_id IS NOT NULL THEN
    SELECT credit_cap INTO v_cap
    FROM public.project_budgets
    WHERE project_id = p_project_id
    FOR UPDATE;
    IF v_cap IS NOT NULL THEN
      SELECT COALESCE(-SUM(delta), 0) INTO v_spent
      FROM public.credit_ledger
      WHERE project_id = p_project_id
        AND delta < 0
        AND created_at >= date_trunc('month', now());
      IF v_spent + p_amount > v_cap THEN
        RAISE EXCEPTION 'PROJECT_BUDGET_EXCEEDED';
      END IF;
    END IF;
  END IF;

  IF v_credits < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_CREDITS';
  END IF;

  UPDATE public.profiles
  SET credits = credits - p_amount
  WHERE id = p_user_id
  RETURNING credits INTO v_credits;

  INSERT INTO public.credit_ledger (user_id, delta, reason, ref_id, workspace_id, project_id)
    VALUES (p_user_id, -p_amount, p_reason, p_ref_id, p_workspace_id, p_project_id);

  RETURN v_credits;
END;
$$;

-- Re-assert the P0-1 posture for the new 6-arg signatures (safe to repeat).
REVOKE ALL ON FUNCTION public.debit_credits_for_minutes(UUID, INTEGER, TEXT, UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.debit_credits_amount_once(UUID, INTEGER, TEXT, UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debit_credits_for_minutes(UUID, INTEGER, TEXT, UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.debit_credits_amount_once(UUID, INTEGER, TEXT, UUID, UUID, UUID) TO service_role;
