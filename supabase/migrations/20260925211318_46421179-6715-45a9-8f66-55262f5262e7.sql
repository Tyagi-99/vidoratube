DROP POLICY IF EXISTS "languages readable by all" ON public.languages;
CREATE POLICY "languages readable when listed" ON public.languages FOR SELECT TO anon, authenticated USING (code IS NOT NULL AND coalesce(status,'') <> 'disabled');

DROP POLICY IF EXISTS "music_tracks public catalog read" ON public.music_tracks;
CREATE POLICY "music_tracks licensed catalog read" ON public.music_tracks FOR SELECT TO authenticated USING (license IS NOT NULL AND provider IS NOT NULL);

DROP POLICY IF EXISTS "language quality gates readable by all" ON public.language_quality_gates;
CREATE POLICY "language quality gates readable for known languages" ON public.language_quality_gates FOR SELECT TO anon, authenticated USING (language_code IS NOT NULL);

DROP POLICY IF EXISTS "language voices readable by all" ON public.language_voices;
CREATE POLICY "language voices readable when selectable" ON public.language_voices FOR SELECT TO anon, authenticated USING (selectable = true OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "safety_rules_public_read" ON public.safety_rules;
CREATE POLICY "safety_rules active read" ON public.safety_rules FOR SELECT TO anon, authenticated USING (active = true OR public.has_role(auth.uid(), 'admin'));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['approvals','brand_kits','client_channels','language_quality_gates','language_voices','languages','meta_connections','notifications','nps_responses','platform_video_stats','publish_warnings','render_chapters','retention_curves','safety_rules','workspace_approvals','workspace_members','workspaces'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "No guest sessions" ON public.%I', t);
    EXECUTE format('CREATE POLICY "No guest sessions" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (coalesce((auth.jwt() ->> ''is_anonymous'')::boolean, false) IS NOT TRUE) WITH CHECK (coalesce((auth.jwt() ->> ''is_anonymous'')::boolean, false) IS NOT TRUE)', t);
  END LOOP;
END $$;