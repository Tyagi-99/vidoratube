-- P0-1: lock down the per-minute credit RPCs to service_role only.
--
-- debit_credits_for_minutes and refund_credits_for_minutes are SECURITY DEFINER
-- (they run as postgres and bypass RLS). PostgreSQL grants EXECUTE to PUBLIC on
-- new functions by default, and no REVOKE was ever issued for these two — so
-- they were callable at POST /rest/v1/rpc/... by anyone holding the anon key:
-- arbitrary grief-drains of other users' balances (debit takes any p_user_id
-- with no auth.uid() check) and self-refunds of every legitimate charge.
--
-- All other SECURITY DEFINER credit RPCs (grant_credits_once,
-- debit_credits_amount_once, finalize_render_billing, adjust_credits,
-- check_rate_limit, log_abuse_signal, ...) already have explicit REVOKEs.
-- This migration brings the two minute-credit RPCs to the same posture.
-- Forward-only and safe to apply on live DBs.

REVOKE ALL ON FUNCTION public.debit_credits_for_minutes(UUID, INTEGER, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debit_credits_for_minutes(UUID, INTEGER, TEXT, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.refund_credits_for_minutes(UUID, INTEGER, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_credits_for_minutes(UUID, INTEGER, TEXT, UUID)
  TO service_role;
