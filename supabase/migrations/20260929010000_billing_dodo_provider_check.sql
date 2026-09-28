-- Billing provider CHECK constraints: allow 'dodo'.
--
-- Dodo Payments is the USD checkout path (see src/lib/billing/dodo.ts), but
-- the provider CHECKs on public.subscriptions and public.billing_events
-- (from 20260925120000_schema_reconciliation.sql) only allowed
-- ('stripe', 'razorpay'). The first Dodo webhook would insert
-- provider='dodo' into billing_events -> CHECK violation (23514, not the
-- dedupe 23505) -> claimBillingEvent throws -> webhook 500s -> credits never
-- granted, and every provider retry fails identically.
--
-- Idempotent: drops any provider CHECK that still excludes 'dodo', then adds
-- the canonical constraint. Safe to re-run.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.subscriptions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%provider%'
      AND pg_get_constraintdef(oid) NOT ILIKE '%dodo%'
  LOOP
    EXECUTE 'ALTER TABLE public.subscriptions DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;

  BEGIN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_provider_check
      CHECK (provider IN ('stripe', 'razorpay', 'dodo'));
  EXCEPTION WHEN duplicate_object THEN
    -- Already migrated; nothing to do.
    NULL;
  END;
END $$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.billing_events'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%provider%'
      AND pg_get_constraintdef(oid) NOT ILIKE '%dodo%'
  LOOP
    EXECUTE 'ALTER TABLE public.billing_events DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;

  BEGIN
    ALTER TABLE public.billing_events
      ADD CONSTRAINT billing_events_provider_check
      CHECK (provider IN ('stripe', 'razorpay', 'dodo'));
  EXCEPTION WHEN duplicate_object THEN
    -- Already migrated; nothing to do.
    NULL;
  END;
END $$;

COMMENT ON CONSTRAINT subscriptions_provider_check ON public.subscriptions IS
  'Allowed billing providers. dodo = Dodo Payments (USD path); stripe kept for legacy rows; razorpay = INR packs.';
COMMENT ON CONSTRAINT billing_events_provider_check ON public.billing_events IS
  'Allowed billing providers for the webhook audit trail. dodo = Dodo Payments (USD path).';
