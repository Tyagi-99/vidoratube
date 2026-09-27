-- Phase 1 (Foundation): widen workspace_members.role for the 6-role model.
--
-- Context: migration 20260926010000 created workspace_members with
--   role text CHECK (role IN ('owner','editor','viewer'))
-- The Phase 1 permission matrix (src/lib/workspace-auth.server.ts) uses
-- owner | admin | strategist | creator | viewer | client.
-- Legacy mapping (kept for backward compatibility):
--   owner  -> owner
--   editor -> creator   (managed workspace data)
--   viewer -> client    (the agency migration seats clients as viewer, and
--                        legacy viewer rows could sign off approvals)
--
-- This migration:
--   1. Backfills stored 'viewer' rows to 'client' so the DB matches the
--      code's legacy interpretation. Reversible: UPDATE ... SET role='viewer'
--      WHERE role='client' (only safe if no genuine new 'client' rows exist yet).
--   2. Replaces the CHECK with the widened value list (explicit constraint
--      name so future migrations can target it).
--   3. Widens is_workspace_editor() so admin/strategist/creator keep the
--      data-access RLS level the permission matrix grants them for
--      workspace working data. Fine-grained checks stay in server functions;
--      RLS remains the coarse gate. viewer/client stay read-only at RLS.

-- 1. Backfill legacy client rows.
UPDATE public.workspace_members SET role = 'client' WHERE role = 'viewer';

-- 2. Replace the CHECK (auto-named workspace_members_role_check by Postgres).
ALTER TABLE public.workspace_members
  DROP CONSTRAINT IF EXISTS workspace_members_role_check;

ALTER TABLE public.workspace_members
  ADD CONSTRAINT workspace_members_role_values_check
  CHECK (role IN ('owner', 'editor', 'viewer', 'admin', 'strategist', 'creator', 'client'));

-- 3. Editor-level RLS now covers the working roles.
CREATE OR REPLACE FUNCTION public.is_workspace_editor(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id = auth.uid()
      AND m.role IN ('owner', 'editor', 'admin', 'strategist', 'creator')
  );
$$;

COMMENT ON CONSTRAINT workspace_members_role_values_check ON public.workspace_members
  IS 'Phase 1 six-role model: owner|admin|strategist|creator|viewer|client, plus legacy editor (maps to creator in code).';
