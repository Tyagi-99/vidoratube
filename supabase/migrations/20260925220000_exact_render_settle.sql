-- Exact render settlement (Sprint 1-2).
--
-- Problem: finalize_render_billing settled reserve -> actual on WORKER
-- WALL-CLOCK minutes (render_completed_at - render_started_at), but the
-- reserve is now the EXACT deterministic quote (finished minutes x mode
-- multipliers, single source of truth in src/lib/billing/per-minute.ts).
-- Settling an exact credit reserve against wall-clock minutes would wrongly
-- refund or overcharge whenever the two differ (e.g. cinema x1.5, or a
-- worker that renders faster/slower than realtime).
--
-- Fix: when the render row carries meta.expected_credits (written at
-- enqueue by buildServerRenderRows), settlement is deterministic: the
-- quoted credits are the final charge — no debit, no refund. The price
-- shown before the render is the price charged. Rows enqueued before exact
-- quoting keep the legacy settle path, but even there the FINISHED OUTPUT
-- duration (renders.duration, seconds) drives billing — worker wall-clock
-- elapsed is only the fallback for legacy rows that never recorded output
-- duration.
--
-- Non-destructive: CREATE OR REPLACE FUNCTION only. No tables created,
-- altered, or dropped; no rows inserted, updated, or deleted. The rls
-- static audit is unaffected (no new tables).
-- Apply via Supabase SQL editor or `supabase db push`.

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
  v_expected_credits INTEGER;
  v_expected_minutes INTEGER;
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

  -- Exact settlement: the row was enqueued with a deterministic quote
  -- (meta.expected_credits / meta.expected_minutes). The reserve was
  -- exact by construction, so there is nothing to debit or refund —
  -- just record the final charge.
  v_expected_credits := (v_render.meta ->> 'expected_credits')::INTEGER;
  IF v_expected_credits IS NOT NULL THEN
    v_expected_minutes := COALESCE((v_render.meta ->> 'expected_minutes')::INTEGER, 0);

    SELECT credits INTO v_credits FROM public.profiles WHERE id = v_render.user_id;

    UPDATE public.renders
    SET billed_minutes = v_expected_minutes,
        credits_charged = v_expected_credits,
        updated_at = now()
    WHERE id = p_render_id;

    RETURN jsonb_build_object(
      'render_id', p_render_id,
      'billed_minutes', v_expected_minutes,
      'credits_charged', v_expected_credits,
      'balance', v_credits,
      'settlement', 'exact'
    );
  END IF;

  -- Legacy path: rows enqueued before exact quoting. Actual finished
  -- OUTPUT duration (renders.duration, seconds) drives billing; worker
  -- wall-clock elapsed is only the fallback for legacy rows that never
  -- recorded output duration.
  IF v_render.duration IS NOT NULL THEN
    v_actual_minutes := GREATEST(1, CEIL(v_render.duration / 60.0)::INTEGER);
  ELSIF v_render.render_started_at IS NOT NULL AND v_render.render_completed_at IS NOT NULL THEN
    v_actual_minutes := GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM (v_render.render_completed_at - v_render.render_started_at)) / 60.0)::INTEGER
    );
  ELSE
    RAISE EXCEPTION 'RENDER_NOT_COMPLETE';
  END IF;

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
    'balance', v_credits,
    'settlement', 'wall_clock_legacy'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_render_billing(UUID) FROM PUBLIC, anon, authenticated;
