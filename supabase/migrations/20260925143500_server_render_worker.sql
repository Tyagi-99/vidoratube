-- P2: Server render worker support on public.renders.
--
-- Extends the renders table (used by the browser FFmpeg.wasm path) with the
-- fields a server-side native-FFmpeg worker needs: atomic claiming, crash
-- recovery, retries, checkpoints, and graceful cancellation.
--
-- Design:
-- - Worker claims jobs with: UPDATE ... WHERE status='queued' AND
--   (claimed_at IS NULL OR claimed_at < now() - interval '5 minutes')
--   AND attempts < max_attempts ... RETURNING *
--   The 5-minute lease means a crashed worker's jobs become claimable again.
-- - cancel_requested lets the UI ask for graceful cancellation; the worker
--   checks it between stages and marks the job 'cancelled'.
-- - checkpoint stores resumable progress (e.g. completed segment indexes).

ALTER TABLE public.renders
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_by text,
  ADD COLUMN IF NOT EXISTS checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS cancel_requested boolean NOT NULL DEFAULT false;

-- Index for the worker's claim query: only queued, unclaimed-or-expired jobs.
CREATE INDEX IF NOT EXISTS renders_worker_claim_idx
  ON public.renders (status, claimed_at)
  WHERE status = 'queued';

-- Atomic job claim for the server worker. Returns the claimed row, or nothing
-- when no claimable job exists. Uses SELECT ... FOR UPDATE SKIP LOCKED so
-- multiple workers never grab the same job.
CREATE OR REPLACE FUNCTION public.claim_render_job(p_worker_id text, p_lease_seconds integer DEFAULT 300)
RETURNS public.renders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.renders%ROWTYPE;
BEGIN
  SELECT *
  INTO v_job
  FROM public.renders
  WHERE status = 'queued'
    AND engine = 'server_ffmpeg'
    AND attempts < max_attempts
    AND (claimed_at IS NULL OR claimed_at < now() - make_interval(secs => p_lease_seconds))
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.renders
  SET status = 'running',
      stage = 'claimed',
      claimed_at = now(),
      claimed_by = p_worker_id,
      attempts = v_job.attempts + 1,
      render_started_at = COALESCE(v_job.render_started_at, now())
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_render_job(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_render_job(text, integer) TO service_role;

-- Mark a job's heartbeat so long renders don't look crashed.
CREATE OR REPLACE FUNCTION public.heartbeat_render_job(p_job_id uuid, p_worker_id text, p_stage text, p_progress integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.renders
  SET claimed_at = now(),
      stage = p_stage,
      progress = LEAST(GREATEST(p_progress, 0), 100)
  WHERE id = p_job_id
    AND claimed_by = p_worker_id
    AND status = 'running';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.heartbeat_render_job(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_render_job(uuid, text, text, integer) TO service_role;
