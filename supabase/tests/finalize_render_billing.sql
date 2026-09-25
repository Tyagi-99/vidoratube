-- Sprint 1-2: finalize_render_billing behavioral assertions.
--
-- HOW TO RUN (against a staging/dev database, never production):
--   1. Create one throwaway auth user and note its UUID as USER_A.
--      The user needs a profiles row with a comfortable credit balance.
--   2. psql "$DATABASE_URL" -v user_a=<uuid> -f supabase/tests/finalize_render_billing.sql
--
-- A clean run prints only NOTICE lines and raises on any failure.
-- \set ON_ERROR_STOP on
--
-- Covers:
--   1. Reserve 10, output 4 finished minutes  -> releases 6 (grant).
--   2. Reserve 10, output 12 finished minutes -> debits 2 (overage).
--   3. Output duration (renders.duration) drives billing, NOT worker
--      wall-clock: started/completed are 1 hour apart but duration = 300s
--      -> billed 5 minutes.
--   4. Double finalize is a no-op (no second charge/refund).
--   5. Legacy rows with NO output duration fall back to wall-clock elapsed.
--   6. Exact-quote rows (meta.expected_credits) settle with zero ledger
--      delta: the price shown before the render is the price charged.

\pset tuples_only off
\set ON_ERROR_STOP on

DO $$
DECLARE
  v_user_a uuid := :'user_a'::uuid;
  v_r1 uuid := gen_random_uuid();
  v_r2 uuid := gen_random_uuid();
  v_r3 uuid := gen_random_uuid();
  v_r4 uuid := gen_random_uuid();
  v_r5 uuid := gen_random_uuid();
  v_out jsonb;
  v_billed int;
  v_charged int;
  v_ledger_count int;
  v_before int;
  v_after int;
BEGIN
  PERFORM set_config('role', 'service_role', true);

  -- Seed: top the user up so reserves/debits never hit INSUFFICIENT_CREDITS.
  PERFORM public.grant_credits_once(v_user_a, 1000, 'settle-test top-up', NULL);

  -- ── Case 1: reserve 10, output 4 min. Wall-clock is 1h (must be ignored).
  INSERT INTO public.renders
    (id, user_id, engine, status, stage, reserved_minutes, duration,
     render_started_at, render_completed_at)
  VALUES
    (v_r1, v_user_a, 'server_ffmpeg', 'completed', 'done', 10, 240,
     now() - interval '1 hour', now());

  -- ── Case 2: reserve 10, output 12 min.
  INSERT INTO public.renders
    (id, user_id, engine, status, stage, reserved_minutes, duration,
     render_started_at, render_completed_at)
  VALUES
    (v_r2, v_user_a, 'server_ffmpeg', 'completed', 'done', 10, 720,
     now() - interval '5 minutes', now());

  -- ── Case 3: output duration 300s, wall-clock 1h -> billed 5, not 60.
  INSERT INTO public.renders
    (id, user_id, engine, status, stage, reserved_minutes, duration,
     render_started_at, render_completed_at)
  VALUES
    (v_r3, v_user_a, 'server_ffmpeg', 'completed', 'done', 10, 300,
     now() - interval '1 hour', now());

  -- ── Case 4: no output duration -> wall-clock fallback (3 min elapsed).
  INSERT INTO public.renders
    (id, user_id, engine, status, stage, reserved_minutes, duration,
     render_started_at, render_completed_at)
  VALUES
    (v_r4, v_user_a, 'server_ffmpeg', 'completed', 'done', 10, NULL,
     now() - interval '3 minutes', now());

  -- ── Case 5: exact-quote row. Reserve the quoted 25 credits first, the
  -- way enqueueServerRender does.
  PERFORM public.debit_credits_amount_once(v_user_a, 25, 'Server render reserve (25 credits)', v_r5);
  INSERT INTO public.renders
    (id, user_id, engine, status, stage, reserved_minutes, duration,
     render_started_at, render_completed_at,
     meta)
  VALUES
    (v_r5, v_user_a, 'server_ffmpeg', 'completed', 'done', 25, 600,
     now() - interval '9 minutes', now(),
     '{"expected_credits": 25, "expected_minutes": 10, "mode": "story"}'::jsonb);

  -- ── Assert 1: under-run releases 6.
  v_out := public.finalize_render_billing(v_r1);
  SELECT billed_minutes, credits_charged INTO v_billed, v_charged
    FROM public.renders WHERE id = v_r1;
  IF v_billed <> 4 THEN
    RAISE EXCEPTION 'case1: expected billed_minutes=4, got %', v_billed;
  END IF;
  IF v_charged <> 10 THEN
    RAISE EXCEPTION 'case1: expected credits_charged=10, got %', v_charged;
  END IF;
  SELECT COUNT(*) INTO v_ledger_count FROM public.credit_ledger
    WHERE user_id = v_user_a AND delta = 6 AND reason LIKE '%used 4%';
  IF v_ledger_count < 1 THEN
    RAISE EXCEPTION 'case1: expected a +6 release grant in the ledger';
  END IF;
  RAISE NOTICE 'case1 OK: reserve 10, output 4 -> billed 4, released 6';

  -- ── Assert 2: over-run debits 2.
  v_out := public.finalize_render_billing(v_r2);
  SELECT billed_minutes, credits_charged INTO v_billed, v_charged
    FROM public.renders WHERE id = v_r2;
  IF v_billed <> 12 THEN
    RAISE EXCEPTION 'case2: expected billed_minutes=12, got %', v_billed;
  END IF;
  IF v_charged <> 12 THEN
    RAISE EXCEPTION 'case2: expected credits_charged=12, got %', v_charged;
  END IF;
  SELECT COUNT(*) INTO v_ledger_count FROM public.credit_ledger
    WHERE user_id = v_user_a AND delta = -2 AND reason LIKE '%overage%';
  IF v_ledger_count < 1 THEN
    RAISE EXCEPTION 'case2: expected a -2 overage debit in the ledger';
  END IF;
  RAISE NOTICE 'case2 OK: reserve 10, output 12 -> billed 12, debited 2';

  -- ── Assert 3: output duration beats wall-clock.
  v_out := public.finalize_render_billing(v_r3);
  SELECT billed_minutes INTO v_billed FROM public.renders WHERE id = v_r3;
  IF v_billed <> 5 THEN
    RAISE EXCEPTION 'case3: expected billed_minutes=5 (output), got % (wall-clock leak?)', v_billed;
  END IF;
  RAISE NOTICE 'case3 OK: 300s output with 1h wall-clock -> billed 5';

  -- ── Assert 4: no output duration -> wall-clock fallback.
  v_out := public.finalize_render_billing(v_r4);
  SELECT billed_minutes INTO v_billed FROM public.renders WHERE id = v_r4;
  IF v_billed <> 3 THEN
    RAISE EXCEPTION 'case4: expected billed_minutes=3 (wall-clock fallback), got %', v_billed;
  END IF;
  RAISE NOTICE 'case4 OK: missing duration -> wall-clock fallback billed 3';

  -- ── Assert 5: exact-quote row settles with zero ledger delta.
  SELECT COUNT(*) INTO v_before FROM public.credit_ledger WHERE user_id = v_user_a;
  v_out := public.finalize_render_billing(v_r5);
  SELECT COUNT(*) INTO v_after FROM public.credit_ledger WHERE user_id = v_user_a;
  SELECT billed_minutes, credits_charged INTO v_billed, v_charged
    FROM public.renders WHERE id = v_r5;
  IF v_billed <> 10 OR v_charged <> 25 THEN
    RAISE EXCEPTION 'case5: expected billed=10/charged=25, got %/%', v_billed, v_charged;
  END IF;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'case5: exact settle must not touch the ledger';
  END IF;
  IF (v_out ->> 'settlement') <> 'exact' THEN
    RAISE EXCEPTION 'case5: expected settlement=exact, got %', v_out;
  END IF;
  RAISE NOTICE 'case5 OK: exact quote 25 credits settles with zero ledger delta';

  -- ── Assert 6: double finalize is a no-op (idempotent).
  SELECT COUNT(*) INTO v_before FROM public.credit_ledger WHERE user_id = v_user_a;
  v_out := public.finalize_render_billing(v_r1);
  SELECT COUNT(*) INTO v_after FROM public.credit_ledger WHERE user_id = v_user_a;
  IF (v_out ->> 'already_finalized')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'case6: expected already_finalized=true, got %', v_out;
  END IF;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'case6: second finalize touched the ledger';
  END IF;
  v_out := public.finalize_render_billing(v_r2);
  SELECT COUNT(*) INTO v_ledger_count FROM public.credit_ledger WHERE user_id = v_user_a;
  IF v_ledger_count <> v_after THEN
    RAISE EXCEPTION 'case6: second finalize of overage case touched the ledger';
  END IF;
  RAISE NOTICE 'case6 OK: double finalize is a no-op';

  -- Cleanup: remove test rows (ledger stays append-only — history remains).
  DELETE FROM public.renders WHERE id IN (v_r1, v_r2, v_r3, v_r4, v_r5);
  RAISE NOTICE 'ALL finalize_render_billing ASSERTIONS PASSED';
END $$;
