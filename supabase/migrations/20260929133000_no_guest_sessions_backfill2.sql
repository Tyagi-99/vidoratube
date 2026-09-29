-- P2-1 follow-up (2026-09-29 QA security audit): "No guest sessions" backfill #2.
--
-- The 2026-09-29 reconciliation migration re-applied the restrictive
-- "No guest sessions" policy to the 17 tables the historical backfill loop
-- targets. The audit found 8 further post-convention tables that never got
-- the restrictive policy (owner RLS still isolates users, but Supabase
-- anonymous sessions have an auth.uid() and could use these tables directly
-- via the anon REST key, bypassing the app's no-guest rule):
--   agent_conversations, agent_messages (20260928050000)
--   alert_rules (20260928060000)
--   checklist_dismissals (20260928060100)
--   onboarding_progress (2026092806a000)
--   monetization_settings (2026092804b000)
--   quick_create_runs, seo_packages (20260928041400)
-- The policy statement is identical to the convention used everywhere else.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['agent_conversations','agent_messages','alert_rules','checklist_dismissals','onboarding_progress','monetization_settings','quick_create_runs','seo_packages'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS "No guest sessions" ON public.%I', t);
    EXECUTE format('CREATE POLICY "No guest sessions" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (coalesce((auth.jwt() ->> ''is_anonymous'')::boolean, false) IS NOT TRUE) WITH CHECK (coalesce((auth.jwt() ->> ''is_anonymous'')::boolean, false) IS NOT TRUE)', t);
  END LOOP;
END $$;
