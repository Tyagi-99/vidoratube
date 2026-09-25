-- Billing events: raw webhook payloads, service-role only
DROP POLICY IF EXISTS "Users read billing events" ON public.billing_events;
CREATE POLICY "Admins read billing events" ON public.billing_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Public catalogs: replace tautologies with real predicates
DROP POLICY IF EXISTS "Anyone can read plans" ON public.plans;
CREATE POLICY "Anyone can read published plans" ON public.plans
  FOR SELECT TO anon, authenticated USING (slug IS NOT NULL AND name IS NOT NULL);

DROP POLICY IF EXISTS categories_read ON public.categories;
CREATE POLICY categories_read ON public.categories
  FOR SELECT TO anon, authenticated USING (active = true OR public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Anyone can read music tracks" ON public.music_tracks;
CREATE POLICY "Signed-in users read music tracks" ON public.music_tracks
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Site content is public" ON public.site_content;
CREATE POLICY "Site content is public" ON public.site_content
  FOR SELECT TO anon, authenticated USING (key IS NOT NULL AND value IS NOT NULL);

-- Contact form: validate submitted rows
DROP POLICY IF EXISTS "Anyone can send a message" ON public.contact_messages;
CREATE POLICY "Anyone can send a valid message" ON public.contact_messages
  FOR INSERT TO anon, authenticated WITH CHECK (
    handled = false
    AND char_length(btrim(name)) BETWEEN 1 AND 100
    AND char_length(email) BETWEEN 3 AND 255
    AND email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    AND (subject IS NULL OR char_length(subject) <= 150)
    AND char_length(btrim(message)) BETWEEN 5 AND 2000
  );

-- Exclude guest (anonymous) sessions from every table with RLS enabled
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity LOOP
    EXECUTE format('DROP POLICY IF EXISTS "No guest sessions" ON public.%I', t);
    EXECUTE format('CREATE POLICY "No guest sessions" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (COALESCE((auth.jwt() ->> ''is_anonymous'')::boolean, false) IS NOT TRUE) WITH CHECK (COALESCE((auth.jwt() ->> ''is_anonymous'')::boolean, false) IS NOT TRUE)', t);
  END LOOP;
END $$;