-- Sprint 1-2: render queue behavioral assertions (claim, stale requeue,
-- retry cap, RLS owner isolation on renders).
--
-- HOW TO RUN (against a staging/dev database, never production):
--   1. Create two throwaway auth users and note their UUIDs as USER_A / USER_B.
--   2. psql "$DATABASE_URL" -v user_a=<uuid> -v user_b=<uuid> -f supabase/tests/render_queue.sql
--
-- A clean run prints only NOTICE lines and raises on any failure.
-- \set ON_ERROR_STOP on

\pset tuples_only off
\set ON_ERROR_STOP on

DO $$
DECLARE
  v_user_a uuid := :'user_a'::uuid;
  v_user_b uuid := :'user_b'::uuid;
  v_count int;
  v_job_id uuid;
  v_claimed public.renders%ROWTYPE;
  v_requeued int;
BEGIN
  PERFORM set_config('role', 'service_role', true);

  -- ── Seed: one queued job per user + jobs for the requeue scenarios ──
  INSERT INTO public.renders (user_id, engine, status, stage, meta)
  VALUES
    (v_user_a, 'server_ffmpeg', 'queued', 'queued', '{"test_tag":"render-queue-test"}'::jsonb),
    (v_user_b, 'server_ffmpeg', 'queued', 'queued', '{"test_tag":"render-queue-test"}'::jsonb)
  ON CONFLICT DO NOTHING;

  -- ── Test 1: two sequential claims; the second gets nothing ─────────────
  -- SKIP LOCKED semantics: the first claim takes a row-level lock and flips
  -- the row to status='running' in the same statement, so a second claim
  -- (concurrent or sequential) can never see it as claimable. True
  -- concurrency can't be scripted in psql, but the sequential case runs the
  -- identical code path: the locked/claimed row is simply not returned.
  v_claimed := public.claim_render_job('worker-1', 300);
  IF v_claimed.id IS NULL THEN
    RAISE EXCEPTION 'claim 1: expected a job, got none';
  END IF;
  IF v_claimed.status <> 'running' OR v_claimed.claimed_by <> 'worker-1' THEN
    RAISE EXCEPTION 'claim 1: row not marked running/claimed_by';
  END IF;
  IF v_claimed.attempts <> 1 THEN
    RAISE EXCEPTION 'claim 1: expected attempts=1, got %', v_claimed.attempts;
  END IF;

  v_claimed := public.claim_render_job('worker-2', 300);
  -- worker-2 may legitimately claim user B's queued row (different job).
  -- What must NOT happen: worker-2 getting worker-1's already-running job.
  -- So: claim once more for the other user's row, then a fourth claim must
  -- find nothing.
  IF v_claimed.id IS NULL THEN
    RAISE EXCEPTION 'claim 2: expected the second queued job, got none';
  END IF;
  v_claimed := public.claim_render_job('worker-3', 300);
  IF v_claimed.id IS NOT NULL THEN
    RAISE EXCEPTION 'claim 3: expected no job (all claimed), got %', v_claimed.id;
  END IF;

  -- Reset the two claimed rows back to queued for the requeue tests below.
  UPDATE public.renders
  SET status = 'queued', stage = 'queued', claimed_at = NULL, claimed_by = NULL, attempts = 0
  WHERE meta->>'test_tag' = 'render-queue-test';

  -- ── Test 2: stale running job -> requeued with attempts incremented ────
  INSERT INTO public.renders (user_id, engine, status, stage, attempts, max_attempts,
                              claimed_at, claimed_by, meta)
  VALUES (v_user_a, 'server_ffmpeg', 'running', 'segments', 1, 3,
          now() - interval '10 minutes', 'dead-worker', '{"test_tag":"render-queue-test"}'::jsonb)
  RETURNING id INTO v_job_id;

  v_requeued := public.requeue_stale_renders(300);
  IF v_requeued < 1 THEN
    RAISE EXCEPTION 'requeue: expected >= 1 requeued job, got %', v_requeued;
  END IF;

  SELECT status, attempts, claimed_by, claimed_at
    INTO v_claimed.status, v_claimed.attempts, v_claimed.claimed_by, v_claimed.claimed_at
    FROM public.renders WHERE id = v_job_id;
  IF v_claimed.status <> 'queued' THEN
    RAISE EXCEPTION 'requeue: expected status=queued, got %', v_claimed.status;
  END IF;
  IF v_claimed.attempts <> 2 THEN
    RAISE EXCEPTION 'requeue: expected attempts=2, got %', v_claimed.attempts;
  END IF;
  IF v_claimed.claimed_by IS NOT NULL OR v_claimed.claimed_at IS NOT NULL THEN
    RAISE EXCEPTION 'requeue: claim was not cleared';
  END IF;

  -- ── Test 3: retry cap -> terminal failure, never requeued ──────────────
  UPDATE public.renders
  SET status = 'running', stage = 'segments', attempts = 3, max_attempts = 3,
      claimed_at = now() - interval '10 minutes', claimed_by = 'dead-worker-2'
  WHERE id = v_job_id;

  v_requeued := public.requeue_stale_renders(300);
  SELECT status, error INTO v_claimed.status, v_claimed.error
    FROM public.renders WHERE id = v_job_id;
  IF v_claimed.status <> 'failed' THEN
    RAISE EXCEPTION 'retry cap: expected status=failed, got %', v_claimed.status;
  END IF;
  IF v_claimed.error <> 'Worker died; retries exhausted' THEN
    RAISE EXCEPTION 'retry cap: unexpected error text: %', v_claimed.error;
  END IF;
  -- A second requeue pass must not touch the failed job (no infinite loop).
  v_requeued := public.requeue_stale_renders(300);
  SELECT status INTO v_claimed.status FROM public.renders WHERE id = v_job_id;
  IF v_claimed.status <> 'failed' THEN
    RAISE EXCEPTION 'retry cap: failed job was resurrected by a second pass';
  END IF;

  -- ── Test 4: fresh running job is untouched ─────────────────────────────
  INSERT INTO public.renders (user_id, engine, status, stage, attempts, max_attempts,
                              claimed_at, claimed_by, meta)
  VALUES (v_user_a, 'server_ffmpeg', 'running', 'segments', 0, 3,
          now(), 'live-worker', '{"test_tag":"render-queue-test"}'::jsonb)
  RETURNING id INTO v_job_id;

  PERFORM public.requeue_stale_renders(300);
  SELECT status, attempts INTO v_claimed.status, v_claimed.attempts
    FROM public.renders WHERE id = v_job_id;
  IF v_claimed.status <> 'running' OR v_claimed.attempts <> 0 THEN
    RAISE EXCEPTION 'fresh job: was wrongly requeued';
  END IF;

  -- ── Test 5: browser_ffmpeg rows are never touched by the server requeue ─
  INSERT INTO public.renders (user_id, engine, status, stage, attempts,
                              claimed_at, meta)
  VALUES (v_user_a, 'browser_ffmpeg', 'running', 'rendering', 0,
          now() - interval '10 minutes', '{"test_tag":"render-queue-test"}'::jsonb)
  RETURNING id INTO v_job_id;

  PERFORM public.requeue_stale_renders(300);
  SELECT status INTO v_claimed.status FROM public.renders WHERE id = v_job_id;
  IF v_claimed.status <> 'running' THEN
    RAISE EXCEPTION 'browser engine: row was wrongly requeued';
  END IF;

  -- ── Test 6: RLS owner isolation on renders ─────────────────────────────
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_a::text)::text, true);

  -- User A cannot read user B's rows.
  SELECT count(*) INTO v_count FROM public.renders
    WHERE user_id = v_user_b AND meta->>'test_tag' = 'render-queue-test';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'RLS: user A read % of user B''s renders rows', v_count;
  END IF;

  -- User A can still read their own rows (policy is not over-denying).
  SELECT count(*) INTO v_count FROM public.renders
    WHERE user_id = v_user_a AND meta->>'test_tag' = 'render-queue-test';
  IF v_count = 0 THEN
    RAISE EXCEPTION 'RLS: user A cannot read their own renders rows';
  END IF;

  -- Cross-user writes must affect zero rows.
  UPDATE public.renders SET status = 'failed'
    WHERE user_id = v_user_b AND meta->>'test_tag' = 'render-queue-test';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'RLS: user A updated % of user B''s renders rows', v_count;
  END IF;

  DELETE FROM public.renders
    WHERE user_id = v_user_b AND meta->>'test_tag' = 'render-queue-test';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'RLS: user A deleted % of user B''s renders rows', v_count;
  END IF;

  PERFORM set_config('role', 'service_role', true);
  RAISE NOTICE 'render queue: all behavioral checks passed';
END $$;

-- Clean up seed rows (append-only guarantee is about user/ledger data, not
-- these throwaway test rows; the script is documented staging-only).
DELETE FROM public.renders WHERE meta->>'test_tag' = 'render-queue-test';
