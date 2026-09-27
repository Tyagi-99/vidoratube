-- 2026092804d000_p4_comments.sql
-- Phase 4 Stream D (comments + notifications).
--
-- The comments, engagement_insights and notifications tables already exist
-- (created in 20260928020200_p1_operations.sql and
-- 20260925200000_notifications.sql with RLS). This migration adds ONLY what
-- is genuinely missing:
--
--   1. notifications.dedup_key — the consume-only notification triggers
--      (Stream D) read other streams' tables (generation_jobs, publish_jobs,
--      experiments, budgets...) and must emit each event exactly once. A
--      partial UNIQUE index on (user_id, dedup_key) makes "already notified"
--      checks race-safe without touching any other table.
--   2. A partial index on comments for the question feed
--      (is_question = true), which the comment UI reads directly.
--
-- Forward-only, non-destructive: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF
-- NOT EXISTS. No rows edited, no tables dropped, no policies changed.

-- ── 1. notifications.dedup_key ─────────────────────────────────────────────
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS dedup_key text;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedup_key_idx
  ON public.notifications (user_id, dedup_key)
  WHERE dedup_key IS NOT NULL;

COMMENT ON COLUMN public.notifications.dedup_key IS
  'Phase 4 (Stream D): stable dedup key for event-driven triggers, e.g. render:<jobId>, publish:<jobId>:<status>, budget:<scope>:<period>, experiment:<id>. Triggers skip rows that already have one. NULL for ad-hoc notifications.';

-- ── 2. comments question-feed index ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS comments_questions_idx
  ON public.comments (user_id, published_at DESC)
  WHERE is_question = true;

-- ── 3. Pin the draft-reply contract as a schema comment ────────────────────
COMMENT ON COLUMN public.comments.metadata IS
  'Phase 4 (F36): draft replies live at metadata.draft_reply = { text, status: draft|approved|posted, approved_by, posted_at }. Posting requires human approval (server-enforced in src/lib/comments/drafts.server.ts). Comments are NEVER auto-deleted — no code path may call a platform delete on comments.';
