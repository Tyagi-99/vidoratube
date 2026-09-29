-- P1-3 (2026-09-29 audit): backstop the createVideoJob idempotency-key
-- SELECT-then-INSERT with a real uniqueness guarantee. Concurrent
-- double-submits with the same key can both pass the pre-insert SELECT and
-- insert twice, spending two credits; the application now catches the 23505
-- from this index and returns the winner's row.
--
-- BEFORE APPLYING: check for pre-existing duplicates —
--   SELECT user_id, idempotency_key, count(*)
--   FROM public.video_jobs
--   WHERE idempotency_key IS NOT NULL
--   GROUP BY 1, 2 HAVING count(*) > 1;
-- If any rows come back, deduplicate (keep the earliest per key) before
-- creating the index, or the CREATE will fail and the migration rolls back.
CREATE UNIQUE INDEX IF NOT EXISTS video_jobs_one_idempotency_key_per_user
  ON public.video_jobs (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
