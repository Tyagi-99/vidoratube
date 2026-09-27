-- Phase 3, Stream B (Research & Scripts): F9 research canvas ordering,
-- F11 deep-research review states + strict mode, F12 script studio flags.
--
-- Forward-only, non-destructive: ALTER TABLE ... ADD COLUMN IF NOT EXISTS
-- only. No new tables — RLS policies from Phase 1 already cover
-- research_sources / research_claims (owner-scoped), and projects carries
-- its existing owner policy. New columns inherit those policies.

-- ── F9: canvas ordering ──────────────────────────────────────────────────
ALTER TABLE public.research_sources
  ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS research_sources_project_position_idx
  ON public.research_sources (project_id, position);

COMMENT ON COLUMN public.research_sources.position IS
  'Phase 3 (F9): canvas ordering. Lower = earlier on the research canvas; set by the reorder server fn.';

-- ── F11: claim review states + provenance gate ───────────────────────────
ALTER TABLE public.research_claims
  ADD COLUMN IF NOT EXISTS review_state text NOT NULL DEFAULT 'unreviewed'
    CHECK (review_state IN ('unreviewed', 'confirmed', 'waived'));
ALTER TABLE public.research_claims
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.research_claims
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE public.research_claims
  ADD COLUMN IF NOT EXISTS review_note text;

COMMENT ON COLUMN public.research_claims.review_state IS
  'Phase 3 (F11): approval-first gate. unreviewed = nobody signed off; confirmed = a human verified the claim against its sources; waived = a human explicitly accepted the claim without full evidence. Only a human reviewer may set this — never auto-set by code.';
COMMENT ON COLUMN public.research_claims.reviewed_by IS
  'Phase 3 (F11): auth.users id of the human reviewer who set review_state. NULL while unreviewed.';

-- ── F11: per-project strict mode ─────────────────────────────────────────
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS research_strict_mode boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.projects.research_strict_mode IS
  'Phase 3 (F11): when true, packaging/publishing is BLOCKED (fail-closed) while any research_claim on the project is unreviewed. The block is enforced in the script-approval server fn and surfaced in the Evidence Desk UI; Stream F consumes checkStrictGate for quick-create.';
