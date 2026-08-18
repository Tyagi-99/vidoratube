CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL
     AND _user_id = auth.uid()
     AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$function$;

REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;

REVOKE SELECT ON public.youtube_connections FROM authenticated;
GRANT SELECT (id, user_id, channel_id, channel_title, expires_at, scope, created_at, updated_at)
  ON public.youtube_connections TO authenticated;
GRANT DELETE ON public.youtube_connections TO authenticated;
GRANT ALL ON public.youtube_connections TO service_role;