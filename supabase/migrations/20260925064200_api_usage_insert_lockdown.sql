-- Lock down api_usage writes: cost rows are server-written only.
-- The client INSERT policy (WITH CHECK auth.uid() = user_id) let any user
-- fabricate cost/analytics rows. All real writes go through the service role
-- (see studio.server.ts); reads of one's own rows are unchanged.
DROP POLICY IF EXISTS "api_usage_insert" ON public.api_usage;
REVOKE INSERT ON public.api_usage FROM authenticated;
