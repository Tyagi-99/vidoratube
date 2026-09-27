-- Phase 3 Stream A (Ideation & Packaging) — F8 Viral Idea Engine.
--
-- Forward-only, non-destructive, IF NOT EXISTS. RLS on video_ideas is
-- unchanged (owner-scoped policies from 20260925120000 already cover the new
-- column — it rides on the same row).
--
-- video_ideas.score: cache for the deterministic F8 IdeaScore
-- ({ computed_at, score: { total, factors[], confidence, verdict } }).
-- The score is recomputable from evidence at any time (scorer.ts); this
-- column only avoids re-running the outlier match on every list render.

ALTER TABLE public.video_ideas
  ADD COLUMN IF NOT EXISTS score jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.video_ideas.score IS
  'Phase 3 (F8): cached deterministic IdeaScore { computed_at, score }. Recomputable via scoreIdeaFn; the cache is never the source of truth.';

-- Backfill guard: none needed (DEFAULT '{}' applies to existing rows).
