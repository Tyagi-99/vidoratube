-- Phase 3 Stream D (Voice Studio F17 + Stock Media F18) — forward-only,
-- non-destructive. IF NOT EXISTS only; no existing tables, rows, functions,
-- or policies are touched.
--
-- The `voices` table (Phase 1, 20260928020100_p1_creation.sql) had no
-- user-scoped index; the Voice Studio library query filters by user_id.
-- Everything else F17/F18 needs already exists: content_assets (= assets
-- canonical, with technical_metadata jsonb for rights), asset_provenance
-- (per-scene licensed-use log), scenes.asset_url / scenes.asset_source,
-- and generated-videos storage with folder-scoped policies (voice samples
-- and TTS outputs live under {user_id}/voices/ and {user_id}/voiceovers/).

-- ── voices: owner lookup index ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS voices_user_idx
  ON public.voices (user_id, updated_at DESC);
