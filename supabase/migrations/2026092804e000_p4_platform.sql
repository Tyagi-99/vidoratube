-- Phase 4 Stream E (F41/F39/F40) — platform: API keys + MCP, brand library,
-- team workspace invites.
--
-- Forward-only, non-destructive: ALTER ... ADD COLUMN IF NOT EXISTS and
-- CREATE TABLE IF NOT EXISTS only. No changes to existing CHECK constraints
-- (notably workspace_members.role) and no changes to existing tables'
-- columns beyond additive ones.

-- ── 1) api_keys: additive operational columns ────────────────────────────
-- The table itself (key_hash only, never the raw key) already exists from
-- 20260928020300. Genuinely missing for key management: last-used tracking
-- and a human label separate from `name` (kept minimal: last_used_at only).
ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

COMMENT ON COLUMN public.api_keys.last_used_at IS
  'Phase 4 (F41): best-effort last-use timestamp, touched on successful API-key
   authentication. Informational for the key-management UI; never used for
   auth decisions.';

-- ── 2) brand_assets (F39 Brand Library) ──────────────────────────────────
-- Workspace-scoped brand asset library: extra logos, font files, intro/outro
-- clips. Files live in the private `brand-library` storage bucket; the row
-- carries the searchable metadata. content_asset_id links into the canonical
-- content_assets store when the asset was promoted from one (nullable:
-- direct uploads are not content items, and content_assets requires a
-- content_item_id, so no fake linkage is manufactured).
CREATE TABLE IF NOT EXISTS public.brand_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  kind text NOT NULL CHECK (kind IN ('logo', 'font', 'intro', 'outro')),
  storage_bucket text NOT NULL DEFAULT 'brand-library'
    CHECK (storage_bucket IN ('brand-library')),
  storage_path text NOT NULL,
  content_type text,
  bytes bigint CHECK (bytes IS NULL OR bytes >= 0),
  content_asset_id uuid REFERENCES public.content_assets(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.brand_assets
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;
-- At most one default asset per (workspace, kind): the "selected" logo /
-- intro / outro / font the workspace uses unless overridden.
CREATE UNIQUE INDEX IF NOT EXISTS brand_assets_default_kind_uniq
  ON public.brand_assets (workspace_id, kind) WHERE is_default;
CREATE INDEX IF NOT EXISTS brand_assets_workspace_idx
  ON public.brand_assets (workspace_id, kind, created_at DESC);

COMMENT ON TABLE public.brand_assets IS
  'Phase 4 (F39): workspace brand library — logos, fonts, intro/outro clips.
   Files in the private brand-library bucket; rows are workspace metadata.
   content_asset_id is set only when the asset genuinely originated as a
   content_assets row (rights tracking lives there via D49).';

-- Private bucket for brand library files (logos/fonts/intro/outro).
INSERT INTO storage.buckets (id, name, public)
VALUES ('brand-library', 'brand-library', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- ── 3) workspace_invites (F40 invite flow) ───────────────────────────────
-- Token-based invites: the raw token is emailed/shown ONCE; only its
-- SHA-256 hash is stored. Acceptance is explicit (recipient clicks accept
-- while signed in) — invites never auto-join an account.
CREATE TABLE IF NOT EXISTS public.workspace_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 200),
  role text NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('owner', 'editor', 'viewer')),
  -- token_hash: SHA-256 of the raw invite token (shown once, never stored).
  token_hash text NOT NULL UNIQUE,
  invited_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workspace_invites_workspace_idx
  ON public.workspace_invites (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS workspace_invites_email_idx
  ON public.workspace_invites (lower(email));

COMMENT ON TABLE public.workspace_invites IS
  'Phase 4 (F40): token-based workspace invites. Raw token shown once and
   emailed (best-effort); only token_hash is stored. Acceptance is an
   explicit signed-in action; a revoked or expired token can never mint
   membership.';

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.brand_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;

-- brand_assets: members read; owners/editors manage. Follows the api_keys
-- pattern from 20260928020300 (helpers avoid the workspace_members
-- recursion trap).
DROP POLICY IF EXISTS "Members read brand assets" ON public.brand_assets;
CREATE POLICY "Members read brand assets"
  ON public.brand_assets FOR SELECT TO authenticated
  USING (public.is_workspace_member(brand_assets.workspace_id));
DROP POLICY IF EXISTS "Editors manage brand assets" ON public.brand_assets;
CREATE POLICY "Editors manage brand assets"
  ON public.brand_assets FOR ALL TO authenticated
  USING (public.is_workspace_editor(brand_assets.workspace_id))
  WITH CHECK (public.is_workspace_editor(brand_assets.workspace_id));

-- workspace_invites: members can read pending invites for their workspace;
-- NO client write policies — rows are written only by the server
-- (service role), mirroring the audit_logs/approvals pattern (D61).
DROP POLICY IF EXISTS "Members read workspace invites" ON public.workspace_invites;
CREATE POLICY "Members read workspace invites"
  ON public.workspace_invites FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_invites.workspace_id));

-- RESTRICTIVE "No guest sessions" on the new tables (mirrors the pattern
-- from 20260925112402 / 20260928020300).
DO $$
DECLARE
  t text;
  tbls text[] := ARRAY['brand_assets', 'workspace_invites'];
BEGIN
  FOREACH t IN ARRAY tbls
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "No guest sessions" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "No guest sessions" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      || 'USING (COALESCE((auth.jwt() ->> ''is_anonymous'')::boolean, false) IS NOT TRUE) '
      || 'WITH CHECK (COALESCE((auth.jwt() ->> ''is_anonymous'')::boolean, false) IS NOT TRUE)',
      t
    );
  END LOOP;
END $$;
