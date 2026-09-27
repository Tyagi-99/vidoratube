-- Phase 4 · Stream B (Analytics) — F30/F31/F32/F33/F37/F38.
--
-- Forward-only, IF NOT EXISTS, no destructive ops.
--
-- D136: `source` is REQUIRED on every analytics/retention snapshot
-- (contracts: youtube_analytics | meta_insights | fixture). The column
-- defaults to 'fixture' so a snapshot whose origin is unknown is ALWAYS
-- rendered with a DEMO DATA label in the UI — we never let an unlabelled
-- row masquerade as platform-measured data. Ingestion paths
-- (src/lib/analytics/dashboard.ts) always write the real source explicitly.

-- ── analytics_snapshots.source ──────────────────────────────────────────
ALTER TABLE public.analytics_snapshots
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'fixture'
  CHECK (source IN ('youtube_analytics', 'meta_insights', 'fixture'));

COMMENT ON COLUMN public.analytics_snapshots.source IS
  'Phase 4 (D136): REQUIRED provenance label. youtube_analytics | meta_insights = platform-measured; fixture = demo/seeded — UI must render DEMO DATA. Defaults to fixture so unknown rows can never look measured.';

-- ── retention_snapshots.source ─────────────────────────────────────────
ALTER TABLE public.retention_snapshots
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'fixture'
  CHECK (source IN ('youtube_analytics', 'meta_insights', 'fixture'));

COMMENT ON COLUMN public.retention_snapshots.source IS
  'Phase 4 (D136): same provenance rule as analytics_snapshots.source. Retention points must never be invented; a fixture row must be labeled DEMO DATA in the UI.';

-- ── monetization_settings (F37) ────────────────────────────────────────
-- Per-user assumed RPM/CPM used ONLY for ESTIMATE revenue math. Nothing in
-- this table is ever presented as measured earnings; the UI always labels
-- derived revenue "ESTIMATE".
CREATE TABLE IF NOT EXISTS public.monetization_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Assumed revenue per 1,000 monetized playbacks, USD. Null = not set.
  rpm_estimate_usd numeric CHECK (rpm_estimate_usd IS NULL OR rpm_estimate_usd >= 0),
  -- Assumed revenue per 1,000 impressions, USD. Null = not set.
  cpm_estimate_usd numeric CHECK (cpm_estimate_usd IS NULL OR cpm_estimate_usd >= 0),
  currency text NOT NULL DEFAULT 'usd' CHECK (currency IN ('usd', 'inr')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.monetization_settings IS
  'Phase 4 (F37): user-assumed RPM/CPM for ESTIMATE revenue math. Estimates are always labeled ESTIMATE in the UI; measured revenue requires revenue_basis=measured on the snapshot.';

ALTER TABLE public.monetization_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS monetization_settings_owner ON public.monetization_settings;
CREATE POLICY monetization_settings_owner ON public.monetization_settings
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS monetization_settings_touch_updated_at ON public.monetization_settings;
CREATE TRIGGER monetization_settings_touch_updated_at
  BEFORE UPDATE ON public.monetization_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
