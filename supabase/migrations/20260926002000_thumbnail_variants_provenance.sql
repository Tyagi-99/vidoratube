-- Sprints 7-8 (workstream B): thumbnail variants + provenance columns.
--
-- NON-DESTRUCTIVE: only widens an existing CHECK constraint and adds two
-- nullable/has-default columns. No data is dropped, renamed, or retyped.
-- RLS policies on public.thumbnails are unchanged (owner-scoped FOR ALL).

-- 1) Allow 4 AI thumbnail variants per aspect (was 3).
-- The inline CHECK from the reconciliation migration is auto-named
-- thumbnails_variant_check; drop by name defensively.
ALTER TABLE public.thumbnails DROP CONSTRAINT IF EXISTS thumbnails_variant_check;
ALTER TABLE public.thumbnails
  ADD CONSTRAINT thumbnails_variant_check CHECK (variant BETWEEN 1 AND 4);

-- 2) Provenance per variant: exact prompt fingerprint + explicit AI flag.
ALTER TABLE public.thumbnails
  ADD COLUMN IF NOT EXISTS prompt_hash TEXT;
ALTER TABLE public.thumbnails
  ADD COLUMN IF NOT EXISTS is_ai_generated BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.thumbnails.prompt_hash IS
  'SHA-256 of the exact prompt sent to the image model for this variant.';
COMMENT ON COLUMN public.thumbnails.is_ai_generated IS
  'True for gateway-generated thumbnails; provenance flag per variant.';
