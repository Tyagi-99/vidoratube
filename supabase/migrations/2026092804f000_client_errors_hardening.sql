-- Client-error telemetry hardening (follow-up to 20260926050000).
--
-- Lovable's pre-publish security scan flags client_errors because its INSERT
-- policy is `WITH CHECK (true)` for anon+authenticated. That policy is
-- INTENTIONAL: anonymous crash telemetry must work for signed-out visitors
-- hitting the root error boundary, and the table is insert-only (no SELECT
-- policy — only the service role can read rows).
--
-- This migration keeps the anonymous insert path but removes the abuse
-- vector (using the table as a free blob store) with DB-enforced payload
-- size caps that match the client-side truncation in
-- src/routes/__root.tsx (message <=1000, stack <=4000, route <=200,
-- user_agent <=300). Caps are set slightly above the client truncation so
-- legitimate reports can never be rejected by drift.
--
-- Forward-only, non-destructive. Constraints are added NOT VALID then
-- validated so a violation reports as a validation failure rather than
-- blocking the whole apply.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_errors_payload_caps_check'
      AND conrelid = 'public.client_errors'::regclass
  ) THEN
    ALTER TABLE public.client_errors
      ADD CONSTRAINT client_errors_payload_caps_check CHECK (
        char_length(message) <= 2000
        AND char_length(COALESCE(stack, '')) <= 8000
        AND char_length(COALESCE(route, '')) <= 500
        AND char_length(COALESCE(user_agent, '')) <= 1000
      ) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.client_errors
  VALIDATE CONSTRAINT client_errors_payload_caps_check;

COMMENT ON CONSTRAINT client_errors_payload_caps_check ON public.client_errors IS
  'Anti-abuse payload caps for the anonymous insert-only telemetry path (see 20260926050000). The anon INSERT policy is intentional; these caps stop blob-store abuse.';
