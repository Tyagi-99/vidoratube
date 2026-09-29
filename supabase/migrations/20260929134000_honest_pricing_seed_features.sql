-- Data fix (2026-09-29 QA marketing-honesty audit): align the
-- pricing_plans.features seed rows with the honest marketing source of
-- truth (src/lib/pricing-display.ts HONEST_FEATURES, which is what the
-- pricing page actually renders).
--
-- The old seed rows over-claimed ("4K exports" — the renderer caps at
-- 1920x1080; "Voice cloning" — legal-gated and unadvertised;
-- "Dedicated manager" / "Custom integrations" — no such services exist).
-- The pricing page overrode them, but any future direct reader of
-- pricing_plans.features would resurface the over-claims.
-- Idempotent: plain UPDATE keyed on slug; safe to re-run.
UPDATE public.pricing_plans
SET features = '["20 finished minutes / month","1080p MP4 exports","AI narration","Burned-in captions","Email support"]'::jsonb
WHERE slug = 'starter';

UPDATE public.pricing_plans
SET features = '["70 finished minutes / month","1080p MP4 exports","More voices as we add them","Burned-in captions","Priority support"]'::jsonb
WHERE slug = 'studio';

UPDATE public.pricing_plans
SET features = '["250 finished minutes / month","1080p landscape and 9:16 exports","Burned-in captions","Volume help via email"]'::jsonb
WHERE slug = 'scale';
