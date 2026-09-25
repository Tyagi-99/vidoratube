-- Sprint 1-2: dead-worker requeue as a single server-side RPC.
--
-- Problem: the worker used to requeue stale jobs with a direct UPDATE from
-- its own code (worker/src/supabase.ts). That path never enforced the retry
-- cap, so a job whose worker died after attempts >= max_attempts would be
-- requeued forever, and every worker reimplemented the stale-job predicate
-- slightly differently.
--
-- This function is now the single authority for crash recovery:
--   * status='running', engine='server_ffmpeg', and the worker heartbeat
--     (renders.claimed_at, refreshed by heartbeat_render_job) older than
--     p_lease_seconds (default 300s) -> the worker is presumed dead.
--   * attempts < max_attempts -> back to 'queued', attempts incremented,
--     claim cleared so the next worker can claim it.
--   * attempts >= max_attempts -> 'failed' with
--     error = 'Worker died; retries exhausted' (terminal; never requeued).
--
-- Non-destructive: one new function + one supporting index. No existing
-- rows, tables, or policies are touched. Only service_role may execute
-- (worker + admin tooling); the claim/heartbeat RPCs follow the same rule.

CREATE OR REPLACE FUNCTION public.requeue_stale_renders(p_lease_seconds integer DEFAULT 300)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requeued integer := 0;
BEGIN
  -- Retry budget exhausted: terminal failure, never requeued again.
  UPDATE public.renders
  SET status = 'failed',
      stage = 'failed',
      error = 'Worker died; retries exhausted',
      claimed_at = NULL,
      claimed_by = NULL
  WHERE status = 'running'
    AND engine = 'server_ffmpeg'
    AND (claimed_at IS NULL OR claimed_at < now() - make_interval(secs => p_lease_seconds))
    AND attempts >= max_attempts;

  -- Attempts remain: back to the queue with the attempt counter bumped so
  -- the claim gate (attempts < max_attempts in claim_render_job) and this
  -- function agree on how many tries are left.
  UPDATE public.renders
  SET status = 'queued',
      stage = 'queued',
      attempts = attempts + 1,
      claimed_at = NULL,
      claimed_by = NULL
  WHERE status = 'running'
    AND engine = 'server_ffmpeg'
    AND (claimed_at IS NULL OR claimed_at < now() - make_interval(secs => p_lease_seconds))
    AND attempts < max_attempts;
  GET DIAGNOSTICS v_requeued = ROW_COUNT;

  RETURN v_requeued;
END;
$$;

REVOKE ALL ON FUNCTION public.requeue_stale_renders(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.requeue_stale_renders(integer) TO service_role;

-- Supporting index for the stale-job scan (small, partial: only running
-- server_ffmpeg jobs are ever examined).
CREATE INDEX IF NOT EXISTS renders_stale_requeue_idx
  ON public.renders (claimed_at)
  WHERE status = 'running' AND engine = 'server_ffmpeg';
