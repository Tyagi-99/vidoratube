-- P1-4 fix (2026-09-29 audit): these tables are created by LATER migrations
-- (language_voices / language_quality_gates: 20260925233000; safety_rules:
-- 20260926020000), so on a clean deploy the DROP POLICY below would raise
-- "relation does not exist" and abort the migration. Guard each pair.
DO $$ BEGIN
  IF to_regclass('public.languages') IS NOT NULL THEN
    DROP POLICY IF EXISTS "languages readable by all" ON public.languages;
    CREATE POLICY "languages readable when listed" ON public.languages FOR SELECT TO anon, authenticated USING (code IS NOT NULL AND coalesce(status,'') <> 'disabled');
  END IF;
  IF to_regclass('public.music_tracks') IS NOT NULL THEN
    DROP POLICY IF EXISTS "music_tracks public catalog read" ON public.music_tracks;
    CREATE POLICY "music_tracks licensed catalog read" ON public.music_tracks FOR SELECT TO authenticated USING (license IS NOT NULL AND provider IS NOT NULL);
  END IF;
  IF to_regclass('public.language_quality_gates') IS NOT NULL THEN
    DROP POLICY IF EXISTS "language quality gates readable by all" ON public.language_quality_gates;
    CREATE POLICY "language quality gates readable for known languages" ON public.language_quality_gates FOR SELECT TO anon, authenticated USING (language_code IS NOT NULL);
  END IF;
  IF to_regclass('public.language_voices') IS NOT NULL THEN
    DROP POLICY IF EXISTS "language voices readable by all" ON public.language_voices;
    CREATE POLICY "language voices readable when selectable" ON public.language_voices FOR SELECT TO anon, authenticated USING (selectable = true OR public.has_role(auth.uid(), 'admin'));
  END IF;
  IF to_regclass('public.safety_rules') IS NOT NULL THEN
    DROP POLICY IF EXISTS "safety_rules_public_read" ON public.safety_rules;
    CREATE POLICY "safety_rules active read" ON public.safety_rules FOR SELECT TO anon, authenticated USING (active = true OR public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['approvals','brand_kits','client_channels','language_quality_gates','language_voices','languages','meta_connections','notifications','nps_responses','platform_video_stats','publish_warnings','render_chapters','retention_curves','safety_rules','workspace_approvals','workspace_members','workspaces'] LOOP
    -- P1-4 fix (2026-09-29 audit): on a clean deploy most of these tables do
    -- not exist yet when this migration runs (they are created by later
    -- migrations). DROP/CREATE POLICY on a missing table raises
    -- "relation does not exist" and aborts the migration. Skip absent tables;
    -- their own creation migrations carry the policy (project convention).
    -- This edit is clean-deploy-only: the migration is already applied to
    -- production, where every table exists.
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS "No guest sessions" ON public.%I', t);
    EXECUTE format('CREATE POLICY "No guest sessions" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (coalesce((auth.jwt() ->> ''is_anonymous'')::boolean, false) IS NOT TRUE) WITH CHECK (coalesce((auth.jwt() ->> ''is_anonymous'')::boolean, false) IS NOT TRUE)', t);
  END LOOP;
END $$;