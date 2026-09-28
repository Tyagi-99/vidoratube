-- Phase 3 Stream C (F16 Character System + F15 scene binding target).
--
-- Forward-only, non-destructive: CREATE TABLE IF NOT EXISTS / ADD COLUMN IF
-- NOT EXISTS / DROP POLICY IF EXISTS only. No data is ever dropped.
--
-- The pre-Phase-3 reconciliation migration (20260925120000) already creates a
-- `public.characters` table without `style_notes`; this migration keeps that
-- table when present (adding the missing column) and creates the full
-- F16 shape when it is absent. It also covers an even older live shape found
-- 2026-09-28 (id/user_id/name/description/style/reference_image_url/
-- created_at — no updated_at, no style_notes): updated_at is added, and the
-- legacy `style` text is preserved into style_notes. All changes additive.
CREATE TABLE IF NOT EXISTS public.characters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  reference_image_url text
    CHECK (reference_image_url IS NULL OR char_length(reference_image_url) <= 2000),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  -- style_notes: per-character style guidance (palette, wardrobe, art style…).
  style_notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Covers the pre-Phase-3 characters table (which lacks style_notes).
ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS style_notes jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Covers live characters tables that predate updated_at entirely (the
-- original characters shape has no updated_at; the index and trigger below
-- need it). Applied 2026-09-28 after the live table was found without it.
ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Preserve legacy `style` text into the new style_notes payload where the
-- old column exists and style_notes is still empty. Additive, reversible.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'characters'
      AND column_name = 'style'
  ) THEN
    UPDATE public.characters
      SET style_notes = jsonb_build_object('legacy_style', style)
      WHERE style IS NOT NULL AND style_notes = '{}'::jsonb;
  END IF;
END $$;

-- F16 scene binding target: metadata jsonb carries { character_id: <uuid> }.
-- (Kept separate from the legacy scenes.character_id column so the binding is
-- explicit F16 data with an auditable write path.)
ALTER TABLE public.scenes
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS characters_user_idx
  ON public.characters (user_id, updated_at DESC);

COMMENT ON TABLE public.characters IS
  'Phase 3 (F16): user-defined recurring characters. reference_image_url points at Supabase Storage; style_notes holds style guidance. The character-CONSISTENCY marketing claim is unverified — a 6-scene proof render is required before any consistency claim is made (see docs/KNOWN_ISSUES.md).';

-- ── RLS: owner-scoped ─────────────────────────────────────────────────────
ALTER TABLE public.characters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS characters_owner ON public.characters;
CREATE POLICY characters_owner ON public.characters
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── updated_at trigger ────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS characters_touch_updated_at ON public.characters;
CREATE TRIGGER characters_touch_updated_at BEFORE UPDATE ON public.characters
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
