-- client_errors INSERT policy: enforce the payload caps in the policy itself.
--
-- Lovable's pre-publish security scan flags the client_errors INSERT policy
-- because it is WITH CHECK (true) for anon+authenticated (see D177 in
-- docs/DECISIONS.md and 2026092804f000_client_errors_hardening.sql).
--
-- The anonymous insert path stays INTENTIONAL: crash telemetry must work for
-- signed-out visitors hitting the root error boundary, and the table remains
-- insert-only (no SELECT policy — only the service role can read rows).
--
-- This migration moves the already-enforced payload caps
-- (client_errors_payload_caps_check) into the policy's WITH CHECK, so the
-- policy itself rejects oversized rows instead of waving everything through
-- with `true`. Behavior is unchanged for legitimate reports: the caps match
-- the table constraint exactly, and the client truncates below them in
-- src/routes/__root.tsx.
--
-- Forward-only, non-destructive: policy replacement only.

DROP POLICY IF EXISTS client_errors_insert ON public.client_errors;

CREATE POLICY client_errors_insert ON public.client_errors
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    char_length(message) <= 2000
    AND char_length(COALESCE(stack, '')) <= 8000
    AND char_length(COALESCE(route, '')) <= 500
    AND char_length(COALESCE(user_agent, '')) <= 1000
  );

COMMENT ON TABLE public.client_errors IS
  'Client-side crash telemetry from the root error boundary. Insert-only for anon+authenticated with DB-enforced payload caps; reads are service-role only.';
