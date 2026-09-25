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
