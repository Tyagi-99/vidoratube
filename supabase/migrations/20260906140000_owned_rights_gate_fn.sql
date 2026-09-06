-- Phase 5: include "owned" in content_rights_approved (Mode 2 user uploads).
-- Mode2 migration widened check constraints; this aligns the SQL helper.

CREATE OR REPLACE FUNCTION public.content_rights_approved(_content_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.content_items c
    WHERE c.id = _content_id
      AND c.rights_status IN (
        'permission_granted','licensed','owned','public_domain'
      )
  );
$$;

REVOKE ALL ON FUNCTION public.content_rights_approved(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.content_rights_approved(uuid) TO authenticated, service_role;
