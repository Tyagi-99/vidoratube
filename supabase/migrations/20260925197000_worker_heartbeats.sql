-- Independent worker-liveness signal.
--
-- Problem (bootstrap deadlock): the app previously considered the server
-- worker "online" only when a server_ffmpeg render row had been claimed or
-- updated within 15 minutes. On a fresh deploy no server render has ever been
-- claimed, so the UI reported the worker offline, fell back to the browser
-- path, never enqueued a server render — and the worker could never become
-- "online".
--
-- Fix: the worker upserts a heartbeat row while idle (and on boot), and the
-- app reads that row instead of inferring liveness from job history.
-- Non-destructive: one new table, no changes to existing tables or rows.

CREATE TABLE IF NOT EXISTS public.worker_heartbeats (
  worker_id TEXT PRIMARY KEY,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.worker_heartbeats ENABLE ROW LEVEL SECURITY;

-- No permissive policies: only service_role (which bypasses RLS) may read or
-- write. The worker upserts with its service key; the app reads the latest
-- heartbeat through a service-role server function. Authenticated clients
-- get nothing — worker infrastructure is not user data.
GRANT ALL ON public.worker_heartbeats TO service_role;
