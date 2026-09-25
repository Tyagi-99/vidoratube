-- Sprint 7-8, workstream C: versioned safety rules + server-enforced approvals.
--
-- Non-destructive: only new tables + one nullable column. No data is
-- modified or dropped. Parent applies this to production separately.
--
-- 1) safety_rules — tunable scorer numbers live in DATA (not code).
--    Public read (reference data like `languages`, D45); service-role write only.
-- 2) approvals — human approval records. Written ONLY by the server
--    (service role, inside approvePublishJob); owner SELECT only so rows
--    cannot be forged through the client.
-- 3) publish_warnings — recorded warnings (e.g. low-score private publish).
-- 4) safety_scores.rule_version — which rule-set version produced the score.

-- ===== safety_rules =====

CREATE TABLE IF NOT EXISTS public.safety_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key TEXT NOT NULL,
  description TEXT NOT NULL,
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL CHECK (version > 0),
  active BOOLEAN NOT NULL DEFAULT true,
  last_reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rule_key, version)
);

ALTER TABLE public.safety_rules ENABLE ROW LEVEL SECURITY;

-- Reference data: readable by everyone (drives the admin panel and public
-- docs of the scoring model). No INSERT/UPDATE/DELETE policies — writes are
-- service-role only (founder-reviewed rule updates).
CREATE POLICY safety_rules_public_read ON public.safety_rules
  FOR SELECT USING (true);

-- Seed v1: exact parity with the hardcoded scorer values in src/lib/safety.ts
-- (Sprint 7-8 C). Detection patterns (word lists, regexes) stay in code;
-- only tunable numbers (weights, thresholds, deductions) live here.
INSERT INTO public.safety_rules (rule_key, description, params, version) VALUES
  ('block_threshold', 'Score below this blocks public publishing (private/unlisted proceed with a recorded warning)', '{"threshold": 50}', 1),
  ('dimension.advertiser', 'Max points: advertiser-friendliness (profanity, sexual, violence/gore, drugs, tragedy language)', '{"max_points": 30}', 1),
  ('dimension.copyright', 'Max points: asset licenses / provenance', '{"max_points": 25}', 1),
  ('dimension.originality', 'Max points: duplication vs research sources', '{"max_points": 20}', 1),
  ('dimension.metadata', 'Max points: title honesty / clickbait', '{"max_points": 15}', 1),
  ('dimension.policy', 'Max points: made-for-kids, disclaimers, synthetic-content disclosure', '{"max_points": 10}', 1),
  ('advertiser.profanity', 'Deduction per unique profanity hit; capped at deduct * cap_multiplier per category', '{"deduct_per_hit": 5, "cap_multiplier": 3}', 1),
  ('advertiser.sexual', 'Deduction per unique sexually-suggestive hit; capped per category', '{"deduct_per_hit": 8, "cap_multiplier": 3}', 1),
  ('advertiser.violence', 'Deduction per unique graphic-violence hit; capped per category', '{"deduct_per_hit": 8, "cap_multiplier": 3}', 1),
  ('advertiser.drugs', 'Deduction per unique drug-reference hit; capped per category', '{"deduct_per_hit": 6, "cap_multiplier": 3}', 1),
  ('advertiser.tragedy', 'Deduction per unique tragedy/crisis hit; capped per category', '{"deduct_per_hit": 4, "cap_multiplier": 3}', 1),
  ('advertiser.density', 'Extra deduction when flagged words saturate the script (>= threshold of words and >= min_flagged_words hits)', '{"density_threshold": 0.05, "min_flagged_words": 3, "deduct": 10}', 1),
  ('copyright.missing_license', 'Deduction per asset with no recorded license; capped', '{"deduct_per_asset": 8, "cap": 16}', 1),
  ('copyright.unverified_license', 'Deduction per asset with unknown/unverified/third-party license; capped', '{"deduct_per_asset": 5, "cap": 10}', 1),
  ('copyright.music_no_url', 'Deduction for a music track without a license URL', '{"deduct": 6}', 1),
  ('originality.high_similarity', 'Shingle-Jaccard similarity above this threshold counts as close match', '{"similarity_threshold": 0.6, "deduct": 12}', 1),
  ('originality.mid_similarity', 'Similarity above this threshold counts as partial overlap', '{"similarity_threshold": 0.35, "deduct": 6}', 1),
  ('originality.low_similarity', 'Similarity above this threshold counts as mild overlap', '{"similarity_threshold": 0.2, "deduct": 3}', 1),
  ('originality.no_commentary', 'Long scripts without original-commentary markers lose points', '{"min_words": 150, "deduct": 4}', 1),
  ('metadata.all_caps', 'Deduction for an ALL-CAPS title', '{"deduct": 3}', 1),
  ('metadata.punctuation', 'Deduction for excessive punctuation (!! / ??) in the title', '{"deduct": 2}', 1),
  ('metadata.clickbait', 'Deduction for classic clickbait phrasing in the title', '{"deduct": 6}', 1),
  ('metadata.title_mismatch', 'Deduction when title keywords barely appear in the script (match ratio below this)', '{"deduct": 5, "match_ratio": 0.4}', 1),
  ('metadata.no_description', 'Deduction for an empty description', '{"deduct": 1}', 1),
  ('policy.kids_unset', 'Deduction when the made-for-kids declaration is missing', '{"deduct": 4}', 1),
  ('policy.advice_no_disclaimer', 'Deduction for medical/financial advice without a disclaimer', '{"deduct": 5}', 1),
  ('policy.synthetic_undisclosed', 'Deduction when AI-generated content disclosure is not confirmed', '{"deduct": 2}', 1),
  ('compounding_criticals', 'Extra deduction when critical issues span multiple dimensions', '{"min_critical_count": 2, "deduct": 10}', 1)
ON CONFLICT (rule_key, version) DO NOTHING;

-- ===== approvals =====

CREATE TABLE IF NOT EXISTS public.approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  video_id UUID REFERENCES public.video_jobs(id) ON DELETE CASCADE,
  publish_job_id UUID REFERENCES public.publish_jobs(id) ON DELETE CASCADE,
  approver_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN (
    'youtube-public', 'youtube-unlisted', 'youtube-private',
    'instagram', 'tiktok', 'x', 'facebook', 'linkedin'
  )),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS approvals_publish_job_idx
  ON public.approvals (publish_job_id);
CREATE INDEX IF NOT EXISTS approvals_user_project_idx
  ON public.approvals (user_id, project_id);

ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;

-- Owners can read their own approval records. There are deliberately NO
-- INSERT/UPDATE/DELETE policies: approval rows are written only by the
-- server (service role) inside approvePublishJob, so a client can never
-- forge an approval to bypass the publish gate.
CREATE POLICY approvals_owner_read ON public.approvals
  FOR SELECT USING (auth.uid() = user_id);

-- ===== publish_warnings =====

CREATE TABLE IF NOT EXISTS public.publish_warnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  publish_job_id UUID NOT NULL REFERENCES public.publish_jobs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS publish_warnings_job_idx
  ON public.publish_warnings (publish_job_id);

ALTER TABLE public.publish_warnings ENABLE ROW LEVEL SECURITY;

-- Owners can read their own warnings. Writes are server-only (service role)
-- so the warning audit trail can't be edited from the client.
CREATE POLICY publish_warnings_owner_read ON public.publish_warnings
  FOR SELECT USING (auth.uid() = user_id);

-- ===== safety_scores.rule_version =====

ALTER TABLE public.safety_scores
  ADD COLUMN IF NOT EXISTS rule_version INTEGER;
