-- YouTube connections: exclude anonymous (guest) sessions, add owner UPDATE, admin DELETE override
DROP POLICY IF EXISTS "Users read own youtube connection" ON public.youtube_connections;
DROP POLICY IF EXISTS "Users disconnect own youtube" ON public.youtube_connections;

CREATE POLICY "Users read own youtube connection"
ON public.youtube_connections FOR SELECT TO authenticated
USING (
  auth.uid() = user_id
  AND coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
);

CREATE POLICY "Users update own youtube connection"
ON public.youtube_connections FOR UPDATE TO authenticated
USING (
  auth.uid() = user_id
  AND coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
)
WITH CHECK (
  auth.uid() = user_id
  AND coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
);

CREATE POLICY "Users disconnect own youtube"
ON public.youtube_connections FOR DELETE TO authenticated
USING (
  auth.uid() = user_id
  AND coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
);

CREATE POLICY "Admins disconnect any youtube"
ON public.youtube_connections FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Renders: add admin read/delete override consistent with the rest of the app
CREATE POLICY "Admins read all renders"
ON public.renders FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete any render"
ON public.renders FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));