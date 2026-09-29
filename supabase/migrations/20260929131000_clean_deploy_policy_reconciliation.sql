-- P1-4 follow-up (2026-09-29 audit): clean-deploy reconciliation.
--
-- Migration 20260925211318 had to skip policy changes for tables that do not
-- exist yet on a clean deploy (guarded with to_regclass). Their creation
-- migrations (20260925233000, 20260926020000) install the OLD permissive
-- policies, so a clean deploy would end with weaker policies than
-- production. This end-of-chain migration re-applies the intended final
-- policies idempotently. All tables exist by this point, and on production
-- (where the policies are already correct) this is a semantic no-op.
DO $$ BEGIN
  IF to_regclass('public.language_voices') IS NOT NULL THEN
    DROP POLICY IF EXISTS "language voices readable by all" ON public.language_voices;
    DROP POLICY IF EXISTS "language voices readable when selectable" ON public.language_voices;
    CREATE POLICY "language voices readable when selectable" ON public.language_voices
      FOR SELECT TO anon, authenticated USING (selectable = true OR public.has_role(auth.uid(), 'admin'));
  END IF;
  IF to_regclass('public.language_quality_gates') IS NOT NULL THEN
    DROP POLICY IF EXISTS "language quality gates readable by all" ON public.language_quality_gates;
    DROP POLICY IF EXISTS "language quality gates readable for known languages" ON public.language_quality_gates;
    CREATE POLICY "language quality gates readable for known languages" ON public.language_quality_gates
      FOR SELECT TO anon, authenticated USING (language_code IS NOT NULL);
  END IF;
  IF to_regclass('public.safety_rules') IS NOT NULL THEN
    DROP POLICY IF EXISTS "safety_rules_public_read" ON public.safety_rules;
    DROP POLICY IF EXISTS "safety_rules active read" ON public.safety_rules;
    CREATE POLICY "safety_rules active read" ON public.safety_rules
      FOR SELECT TO anon, authenticated USING (active = true OR public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

-- Re-apply the restrictive "No guest sessions" policy to every table the
-- 20260925211318 backfill loop targets (idempotent; skipped tables on clean
-- deploys get it here).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['approvals','brand_kits','client_channels','language_quality_gates','language_voices','languages','meta_connections','notifications','nps_responses','platform_video_stats','publish_warnings','render_chapters','retention_curves','safety_rules','workspace_approvals','workspace_members','workspaces'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS "No guest sessions" ON public.%I', t);
    EXECUTE format('CREATE POLICY "No guest sessions" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (coalesce((auth.jwt() ->> ''is_anonymous'')::boolean, false) IS NOT TRUE) WITH CHECK (coalesce((auth.jwt() ->> ''is_anonymous'')::boolean, false) IS NOT TRUE)', t);
  END LOOP;
END $$;
