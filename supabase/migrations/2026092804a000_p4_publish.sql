-- Phase 4, Stream A (F27/F28/F29 + publish flow).
--
-- Forward-only, IF NOT EXISTS, no destructive ops. Only adds what is
-- genuinely missing:
--   1. publish_jobs.idempotency_key — unique key per publish job so retried
--      creates/uploads resolve to the same row instead of duplicating it
--      (D136). Existing rows are backfilled; new rows get a generated default.
--
-- Everything else Stream A needs already exists: channel_connections (F27
-- registry), approvals + publish_warnings (D61/D62), audit_logs (reschedule
-- + metadata-overwrite audit trail), api_usage (YouTube quota visibility,
-- D65), workspace_approvals (client sign-off, D78).

-- 1) idempotency_key on publish_jobs ---------------------------------------
ALTER TABLE public.publish_jobs
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Backfill existing rows before constraining.
UPDATE public.publish_jobs
  SET idempotency_key = 'job_' || id::text
  WHERE idempotency_key IS NULL;

ALTER TABLE public.publish_jobs
  ALTER COLUMN idempotency_key SET DEFAULT ('job_' || gen_random_uuid()::text);

ALTER TABLE public.publish_jobs
  ALTER COLUMN idempotency_key SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'publish_jobs_idempotency_key_unique'
  ) THEN
    ALTER TABLE public.publish_jobs
      ADD CONSTRAINT publish_jobs_idempotency_key_unique
      UNIQUE (idempotency_key);
  END IF;
END $$;

COMMENT ON COLUMN public.publish_jobs.idempotency_key IS
  'Phase 4 (F27/F28/F29): unique idempotency key per publish job. A retried create resolves to the existing row instead of duplicating it.';
