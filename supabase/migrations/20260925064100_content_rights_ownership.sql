-- Close the content_rights_approved oracle.
-- The function is SECURITY DEFINER with EXECUTE granted to `authenticated` but
-- performed no ownership check, so any signed-in user could probe arbitrary
-- content ids and infer row existence / rights status. Scope it to the caller's
-- own rows. (No runtime callers exist today besides the type declaration, so
-- nothing depends on cross-user probing.)
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
      AND c.user_id = auth.uid()
      AND c.rights_status IN (
        'permission_granted','licensed','owned','public_domain'
      )
  );
$$;

REVOKE ALL ON FUNCTION public.content_rights_approved(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.content_rights_approved(uuid) TO authenticated, service_role;
