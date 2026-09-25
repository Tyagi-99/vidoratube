-- Sprint 0: INR prices on the public pricing catalog.
-- Non-destructive: ADD COLUMN IF NOT EXISTS, backfill once, never touches
-- existing rows' USD values. The pricing page shows USD by default and INR
-- only for Indian visitors (best-effort geo header) or via the manual toggle.

ALTER TABLE public.pricing_plans
  ADD COLUMN IF NOT EXISTS price_monthly_inr NUMERIC(10,2);

-- Honest INR anchors (recorded in docs/DECISIONS.md): $19 -> ₹1,599,
-- $49 -> ₹3,999, $149 -> ₹11,999. Only fills rows that have no INR yet.
UPDATE public.pricing_plans
SET price_monthly_inr = CASE slug
  WHEN 'starter' THEN 1599
  WHEN 'studio' THEN 3999
  WHEN 'scale' THEN 11999
  ELSE ROUND(price_monthly * 83.2, 0)
END
WHERE price_monthly_inr IS NULL;
