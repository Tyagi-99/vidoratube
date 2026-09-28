-- Voice Intelligence Layer (D327, Stream B backend).
--
-- Reference tables (voice_categories / voice_models / voice_characters) are
-- PUBLIC read by design: curated catalog data, no user data. They carry an
-- explicit `FOR SELECT USING (true)` policy (flagged-but-intended per the
-- pre-publish security-scan guidance for public reference data).
--
-- Everything else is owner-scoped via auth.uid(). generated_voice_previews
-- additionally carries a `user_id` column (not in the original spec) so the
-- owner-only RLS is enforceable, and its uniqueness is (user_id, cache_key)
-- so per-user cache rows never collide across users.
--
-- Forward-only, non-destructive: CREATE TABLE IF NOT EXISTS only. Seeds are
-- idempotent upserts (ON CONFLICT DO UPDATE), generated from
-- src/lib/voice-intel/catalog.ts by /tmp/visql/gen-seeds.js (not committed).

-- ── voice_categories (17 curated content categories) ────────────────────
CREATE TABLE IF NOT EXISTS public.voice_categories (
  id text PRIMARY KEY,
  label text NOT NULL,
  icon text NOT NULL DEFAULT '',
  blurb text NOT NULL DEFAULT '',
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.voice_categories IS
  'Voice Intelligence: public curated voice category cards (17). Reference data — public read by design.';

-- ── voice_models (5 TTS model metadata rows) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.voice_models (
  id text PRIMARY KEY,
  provider text NOT NULL DEFAULT 'elevenlabs',
  label text NOT NULL,
  quality integer NOT NULL DEFAULT 3 CHECK (quality BETWEEN 1 AND 5),
  speed text NOT NULL DEFAULT 'medium'
    CHECK (speed IN ('very_fast', 'fast', 'medium', 'slow')),
  expressiveness text NOT NULL DEFAULT 'medium'
    CHECK (expressiveness IN ('low', 'medium', 'high', 'very_high')),
  multilingual boolean NOT NULL DEFAULT false,
  supported_languages jsonb NOT NULL DEFAULT '[]'::jsonb,
  best_for text NOT NULL DEFAULT '',
  cost_multiplier numeric NOT NULL DEFAULT 1 CHECK (cost_multiplier > 0),
  supported_params jsonb NOT NULL DEFAULT '[]'::jsonb,
  maturity text NOT NULL DEFAULT 'stable'
    CHECK (maturity IN ('stable', 'beta', 'alpha')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.voice_models IS
  'Voice Intelligence: TTS model metadata seed, refreshable from the provider. Reference data — public read by design.';

-- ── voice_characters (40 curated voice characters) ───────────────────────
CREATE TABLE IF NOT EXISTS public.voice_characters (
  id text PRIMARY KEY,
  name text NOT NULL,
  language_code text NOT NULL,
  gender text NOT NULL CHECK (gender IN ('masculine', 'feminine', 'neutral')),
  accent text,
  personality_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  category_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  description text NOT NULL DEFAULT '',
  recommended_for jsonb NOT NULL DEFAULT '[]'::jsonb,
  score numeric NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 10),
  is_default boolean NOT NULL DEFAULT false,
  provider text NOT NULL DEFAULT 'elevenlabs',
  -- provider_voice_id is set ONLY for ids already in the codebase
  -- (adam, elli). NULL + status 'unmapped' for everything else.
  provider_voice_id text,
  supported_models jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'unmapped'
    CHECK (status IN ('verified', 'mapped', 'unmapped', 'legacy', 'unavailable')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS voice_characters_language_idx
  ON public.voice_characters (language_code);
COMMENT ON TABLE public.voice_characters IS
  'Voice Intelligence: 40 curated voice characters (EN/HI/ES/DE). provider_voice_id/status are live operational state — the seed upsert below never clobbers them. Reference data — public read by design.';

-- ── voice_profiles (user-saved reusable voice configurations) ────────────
CREATE TABLE IF NOT EXISTS public.voice_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  -- selection: VoiceSelection JSON { languageCode, categoryId, characterId,
  -- modelId, settings, customised }.
  selection jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
CREATE INDEX IF NOT EXISTS voice_profiles_user_idx
  ON public.voice_profiles (user_id, updated_at DESC);
COMMENT ON TABLE public.voice_profiles IS
  'Voice Intelligence: per-user saved voice configurations (owner-only).';

-- ── user_voice_favorites (character favorites) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.user_voice_favorites (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  character_id text NOT NULL REFERENCES public.voice_characters(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, character_id)
);
COMMENT ON TABLE public.user_voice_favorites IS
  'Voice Intelligence: per-user favorite voice characters (owner-only).';

-- ── channel_voice_defaults (per-scope default voice selection) ───────────
CREATE TABLE IF NOT EXISTS public.channel_voice_defaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- scope: free string like 'project:<uuid>' or 'channel:<handle>'.
  scope text NOT NULL CHECK (char_length(scope) BETWEEN 1 AND 160),
  -- selection: VoiceSelection JSON.
  selection jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, scope)
);
COMMENT ON TABLE public.channel_voice_defaults IS
  'Voice Intelligence: per-scope default voice selection, e.g. one voice per channel/project (owner-only).';

-- ── generated_voice_previews (preview audio cache) ───────────────────────
CREATE TABLE IF NOT EXISTS public.generated_voice_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- cache_key: sha256(characterId|modelId|text). Uniqueness is per user so
  -- one user's cached preview can never collide with another's.
  cache_key text NOT NULL,
  character_id text NOT NULL,
  model_id text NOT NULL,
  text_hash text NOT NULL,
  audio_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, cache_key)
);
CREATE INDEX IF NOT EXISTS generated_voice_previews_user_idx
  ON public.generated_voice_previews (user_id, created_at DESC);
COMMENT ON TABLE public.generated_voice_previews IS
  'Voice Intelligence: cached voice preview audio (owner-only read/insert).';

-- ── voice_generation_jobs (narration job ledger) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.voice_generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  character_id text NOT NULL,
  model_id text NOT NULL,
  characters integer NOT NULL CHECK (characters >= 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'succeeded', 'failed')),
  audio_url text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS voice_generation_jobs_user_idx
  ON public.voice_generation_jobs (user_id, created_at DESC);
COMMENT ON TABLE public.voice_generation_jobs IS
  'Voice Intelligence: narration generation job ledger (owner-only).';

-- ── voice_analytics_events (best-effort usage analytics) ─────────────────
CREATE TABLE IF NOT EXISTS public.voice_analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  event text NOT NULL CHECK (char_length(event) BETWEEN 1 AND 80),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS voice_analytics_events_event_idx
  ON public.voice_analytics_events (event, created_at DESC);
COMMENT ON TABLE public.voice_analytics_events IS
  'Voice Intelligence: best-effort voice usage analytics. Insert-only (no SELECT policy) — rows are written by the server and read by ops tooling.';

-- ── projects.voice_config (per-project persisted VoiceSelection) ─────────
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS voice_config jsonb;
COMMENT ON COLUMN public.projects.voice_config IS
  'Voice Intelligence: per-project persisted VoiceSelection JSON (null = not set).';

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.voice_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_voice_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_voice_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_voice_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_analytics_events ENABLE ROW LEVEL SECURITY;

-- Reference tables: public read by design (curated catalog, no user data).
-- Explicit USING (true) — the pre-publish security scan flags
-- `auth.uid() IS NOT NULL` as effectively-public, so public intent is stated
-- directly rather than through an auth-shaped predicate.
DROP POLICY IF EXISTS voice_categories_public_read ON public.voice_categories;
CREATE POLICY voice_categories_public_read ON public.voice_categories
  FOR SELECT USING (true);
DROP POLICY IF EXISTS voice_models_public_read ON public.voice_models;
CREATE POLICY voice_models_public_read ON public.voice_models
  FOR SELECT USING (true);
DROP POLICY IF EXISTS voice_characters_public_read ON public.voice_characters;
CREATE POLICY voice_characters_public_read ON public.voice_characters
  FOR SELECT USING (true);

-- Owner-scoped tables.
DROP POLICY IF EXISTS voice_profiles_owner ON public.voice_profiles;
CREATE POLICY voice_profiles_owner ON public.voice_profiles
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS user_voice_favorites_owner ON public.user_voice_favorites;
CREATE POLICY user_voice_favorites_owner ON public.user_voice_favorites
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS channel_voice_defaults_owner ON public.channel_voice_defaults;
CREATE POLICY channel_voice_defaults_owner ON public.channel_voice_defaults
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS generated_voice_previews_owner ON public.generated_voice_previews;
CREATE POLICY generated_voice_previews_owner ON public.generated_voice_previews
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS voice_generation_jobs_owner ON public.voice_generation_jobs;
CREATE POLICY voice_generation_jobs_owner ON public.voice_generation_jobs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Analytics: insert-only. No SELECT policy (reads return nothing); the
-- server writes rows and ops tooling reads them outside RLS.
DROP POLICY IF EXISTS voice_analytics_events_insert ON public.voice_analytics_events;
CREATE POLICY voice_analytics_events_insert ON public.voice_analytics_events
  FOR INSERT WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

-- RESTRICTIVE "No guest sessions" on the user-scoped tables (mirrors
-- migration 20260928020100_p1_creation.sql). Reference tables are
-- intentionally public and are excluded.
DO $$
DECLARE
  t text;
  tbls text[] := ARRAY[
    'voice_profiles', 'user_voice_favorites', 'channel_voice_defaults',
    'generated_voice_previews', 'voice_generation_jobs', 'voice_analytics_events'
  ];
BEGIN
  FOREACH t IN ARRAY tbls
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "No guest sessions" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "No guest sessions" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      || 'USING (COALESCE((auth.jwt() ->> ''is_anonymous'')::boolean, false) IS NOT TRUE) '
      || 'WITH CHECK (COALESCE((auth.jwt() ->> ''is_anonymous'')::boolean, false) IS NOT TRUE)',
      t
    );
  END LOOP;
END $$;

-- updated_at triggers (tables that carry updated_at).
DROP TRIGGER IF EXISTS voice_categories_touch_updated_at ON public.voice_categories;
CREATE TRIGGER voice_categories_touch_updated_at BEFORE UPDATE ON public.voice_categories
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS voice_models_touch_updated_at ON public.voice_models;
CREATE TRIGGER voice_models_touch_updated_at BEFORE UPDATE ON public.voice_models
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS voice_characters_touch_updated_at ON public.voice_characters;
CREATE TRIGGER voice_characters_touch_updated_at BEFORE UPDATE ON public.voice_characters
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS voice_profiles_touch_updated_at ON public.voice_profiles;
CREATE TRIGGER voice_profiles_touch_updated_at BEFORE UPDATE ON public.voice_profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS channel_voice_defaults_touch_updated_at ON public.channel_voice_defaults;
CREATE TRIGGER channel_voice_defaults_touch_updated_at BEFORE UPDATE ON public.channel_voice_defaults
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS voice_generation_jobs_touch_updated_at ON public.voice_generation_jobs;
CREATE TRIGGER voice_generation_jobs_touch_updated_at BEFORE UPDATE ON public.voice_generation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── voice_categories seed (17 rows from catalog.ts) ────────────────────
INSERT INTO public.voice_categories (id, label, icon, blurb, sort) VALUES ('cinematic', 'Cinematic', '🎬', 'Epic, dramatic narration', 1) ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, icon = EXCLUDED.icon, blurb = EXCLUDED.blurb, sort = EXCLUDED.sort;
INSERT INTO public.voice_categories (id, label, icon, blurb, sort) VALUES ('storytelling', 'Storytelling', '📖', 'Warm narrative voices', 2) ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, icon = EXCLUDED.icon, blurb = EXCLUDED.blurb, sort = EXCLUDED.sort;
INSERT INTO public.voice_categories (id, label, icon, blurb, sort) VALUES ('emotional', 'Emotional', '❤️', 'Heartfelt delivery', 3) ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, icon = EXCLUDED.icon, blurb = EXCLUDED.blurb, sort = EXCLUDED.sort;
INSERT INTO public.voice_categories (id, label, icon, blurb, sort) VALUES ('documentary', 'Documentary', '🎥', 'Authoritative factual tone', 4) ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, icon = EXCLUDED.icon, blurb = EXCLUDED.blurb, sort = EXCLUDED.sort;
INSERT INTO public.voice_categories (id, label, icon, blurb, sort) VALUES ('crime_mystery', 'Crime & Mystery', '🔍', 'Dark, suspenseful', 5) ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, icon = EXCLUDED.icon, blurb = EXCLUDED.blurb, sort = EXCLUDED.sort;
INSERT INTO public.voice_categories (id, label, icon, blurb, sort) VALUES ('horror', 'Horror', '👻', 'Chilling atmosphere', 6) ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, icon = EXCLUDED.icon, blurb = EXCLUDED.blurb, sort = EXCLUDED.sort;
INSERT INTO public.voice_categories (id, label, icon, blurb, sort) VALUES ('business_finance', 'Business & Finance', '💼', 'Sharp and credible', 7) ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, icon = EXCLUDED.icon, blurb = EXCLUDED.blurb, sort = EXCLUDED.sort;
INSERT INTO public.voice_categories (id, label, icon, blurb, sort) VALUES ('educational', 'Educational', '🧠', 'Clear teaching voices', 8) ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, icon = EXCLUDED.icon, blurb = EXCLUDED.blurb, sort = EXCLUDED.sort;
INSERT INTO public.voice_categories (id, label, icon, blurb, sort) VALUES ('shorts_reels', 'Shorts & Reels', '⚡', 'Punchy and fast', 9) ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, icon = EXCLUDED.icon, blurb = EXCLUDED.blurb, sort = EXCLUDED.sort;
INSERT INTO public.voice_categories (id, label, icon, blurb, sort) VALUES ('news', 'News / Informational', '📰', 'Crisp and neutral', 10) ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, icon = EXCLUDED.icon, blurb = EXCLUDED.blurb, sort = EXCLUDED.sort;
INSERT INTO public.voice_categories (id, label, icon, blurb, sort) VALUES ('motivational', 'Motivational', '🔥', 'Driving energy', 11) ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, icon = EXCLUDED.icon, blurb = EXCLUDED.blurb, sort = EXCLUDED.sort;
INSERT INTO public.voice_categories (id, label, icon, blurb, sort) VALUES ('conversational', 'Conversational', '💬', 'Natural and casual', 12) ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, icon = EXCLUDED.icon, blurb = EXCLUDED.blurb, sort = EXCLUDED.sort;
INSERT INTO public.voice_categories (id, label, icon, blurb, sort) VALUES ('podcast', 'Podcast', '🎙', 'Long-listen comfort', 13) ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, icon = EXCLUDED.icon, blurb = EXCLUDED.blurb, sort = EXCLUDED.sort;
INSERT INTO public.voice_categories (id, label, icon, blurb, sort) VALUES ('soft_calm', 'Soft / Calm', '🌸', 'Gentle and soothing', 14) ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, icon = EXCLUDED.icon, blurb = EXCLUDED.blurb, sort = EXCLUDED.sort;
INSERT INTO public.voice_categories (id, label, icon, blurb, sort) VALUES ('entertainment', 'Casual / Entertainment', '😂', 'Fun and lively', 15) ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, icon = EXCLUDED.icon, blurb = EXCLUDED.blurb, sort = EXCLUDED.sort;
INSERT INTO public.voice_categories (id, label, icon, blurb, sort) VALUES ('lifestyle_beauty', 'Lifestyle / Beauty', '💄', 'Friendly and modern', 16) ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, icon = EXCLUDED.icon, blurb = EXCLUDED.blurb, sort = EXCLUDED.sort;
INSERT INTO public.voice_categories (id, label, icon, blurb, sort) VALUES ('technology_ai', 'Technology / AI', '🚀', 'Smart and precise', 17) ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, icon = EXCLUDED.icon, blurb = EXCLUDED.blurb, sort = EXCLUDED.sort;

-- ── voice_models seed (5 rows from catalog.ts) ─────────────────────────
INSERT INTO public.voice_models (id, provider, label, quality, speed, expressiveness, multilingual, supported_languages, best_for, cost_multiplier, supported_params, maturity, is_active) VALUES ('eleven_multilingual_v2', 'elevenlabs', 'Eleven Multilingual v2', 4, 'medium', 'high', TRUE, '["en","hi","es","de","fr","pt","it","ar","ja","ko","id","tr"]', 'Long-form documentaries — quality and voice consistency', 2, '["stability","similarity_boost","style","speed","speaker_boost"]', 'stable', TRUE) ON CONFLICT (id) DO UPDATE SET provider = EXCLUDED.provider, label = EXCLUDED.label, quality = EXCLUDED.quality, speed = EXCLUDED.speed, expressiveness = EXCLUDED.expressiveness, multilingual = EXCLUDED.multilingual, supported_languages = EXCLUDED.supported_languages, best_for = EXCLUDED.best_for, cost_multiplier = EXCLUDED.cost_multiplier, supported_params = EXCLUDED.supported_params, maturity = EXCLUDED.maturity, is_active = EXCLUDED.is_active;
INSERT INTO public.voice_models (id, provider, label, quality, speed, expressiveness, multilingual, supported_languages, best_for, cost_multiplier, supported_params, maturity, is_active) VALUES ('eleven_flash_v2_5', 'elevenlabs', 'Eleven Flash v2.5', 4, 'very_fast', 'medium', TRUE, '["en","hi","es","de","fr","pt","it","ar","ja","ko","id","tr"]', 'Shorts & Reels — fastest generation, low latency', 1, '["stability","similarity_boost","style","speed","speaker_boost"]', 'stable', TRUE) ON CONFLICT (id) DO UPDATE SET provider = EXCLUDED.provider, label = EXCLUDED.label, quality = EXCLUDED.quality, speed = EXCLUDED.speed, expressiveness = EXCLUDED.expressiveness, multilingual = EXCLUDED.multilingual, supported_languages = EXCLUDED.supported_languages, best_for = EXCLUDED.best_for, cost_multiplier = EXCLUDED.cost_multiplier, supported_params = EXCLUDED.supported_params, maturity = EXCLUDED.maturity, is_active = EXCLUDED.is_active;
INSERT INTO public.voice_models (id, provider, label, quality, speed, expressiveness, multilingual, supported_languages, best_for, cost_multiplier, supported_params, maturity, is_active) VALUES ('eleven_turbo_v2_5', 'elevenlabs', 'Eleven Turbo v2.5', 3, 'fast', 'low', TRUE, '["en","hi","es","de","fr","pt","it"]', 'Drafts and high-volume generation where speed beats nuance', 1, '["stability","similarity_boost","style","speed","speaker_boost"]', 'stable', TRUE) ON CONFLICT (id) DO UPDATE SET provider = EXCLUDED.provider, label = EXCLUDED.label, quality = EXCLUDED.quality, speed = EXCLUDED.speed, expressiveness = EXCLUDED.expressiveness, multilingual = EXCLUDED.multilingual, supported_languages = EXCLUDED.supported_languages, best_for = EXCLUDED.best_for, cost_multiplier = EXCLUDED.cost_multiplier, supported_params = EXCLUDED.supported_params, maturity = EXCLUDED.maturity, is_active = EXCLUDED.is_active;
INSERT INTO public.voice_models (id, provider, label, quality, speed, expressiveness, multilingual, supported_languages, best_for, cost_multiplier, supported_params, maturity, is_active) VALUES ('eleven_v3', 'elevenlabs', 'Eleven v3 (alpha)', 5, 'medium', 'very_high', TRUE, '["en","hi","es","de"]', 'Cinematic storytelling — maximum expressiveness', 2, '["stability","similarity_boost","style","speed","speaker_boost"]', 'alpha', TRUE) ON CONFLICT (id) DO UPDATE SET provider = EXCLUDED.provider, label = EXCLUDED.label, quality = EXCLUDED.quality, speed = EXCLUDED.speed, expressiveness = EXCLUDED.expressiveness, multilingual = EXCLUDED.multilingual, supported_languages = EXCLUDED.supported_languages, best_for = EXCLUDED.best_for, cost_multiplier = EXCLUDED.cost_multiplier, supported_params = EXCLUDED.supported_params, maturity = EXCLUDED.maturity, is_active = EXCLUDED.is_active;
INSERT INTO public.voice_models (id, provider, label, quality, speed, expressiveness, multilingual, supported_languages, best_for, cost_multiplier, supported_params, maturity, is_active) VALUES ('openai_tts_1', 'openai', 'OpenAI TTS-1', 3, 'very_fast', 'low', TRUE, '["en","es","de","fr","pt","it"]', 'Fallback provider — only used when ElevenLabs is unavailable', 1, '["speed"]', 'stable', TRUE) ON CONFLICT (id) DO UPDATE SET provider = EXCLUDED.provider, label = EXCLUDED.label, quality = EXCLUDED.quality, speed = EXCLUDED.speed, expressiveness = EXCLUDED.expressiveness, multilingual = EXCLUDED.multilingual, supported_languages = EXCLUDED.supported_languages, best_for = EXCLUDED.best_for, cost_multiplier = EXCLUDED.cost_multiplier, supported_params = EXCLUDED.supported_params, maturity = EXCLUDED.maturity, is_active = EXCLUDED.is_active;

-- ── voice_characters seed (40 rows from catalog.ts) ────────────────────
-- HONESTY: provider_voice_id is set ONLY for ids already in the codebase
-- (adam → pNInz6obpgDQGcFmaJgB, elli → MF3mGyEYCl7XYWb3QV9V). All other
-- characters are unmapped (NULL). Never hand-add provider ids here.
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('adam', 'Adam', 'en', 'masculine', NULL, '["deep","dark","cinematic","authoritative","dramatic"]', '["cinematic","storytelling","crime_mystery","documentary","motivational","shorts_reels"]', 'Powerful cinematic narrator suited for dramatic stories and high-retention YouTube content.', '["Faceless YouTube videos","Business stories","Mystery channels","Motivational videos","Documentaries"]', 9.8, TRUE, 'elevenlabs', 'pNInz6obpgDQGcFmaJgB', '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'mapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('sawyer', 'Sawyer', 'en', 'masculine', NULL, '["dark","atmospheric","serious","mysterious"]', '["crime_mystery","horror","documentary","storytelling"]', 'Dark, atmospheric narrator built for suspense-driven storytelling. Ideal for longer mystery formats.', '["True crime","Dark history","Reddit stories","Horror narration"]', 9.6, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('darian', 'Darian', 'en', 'masculine', NULL, '["warm","grounded","natural","storyteller"]', '["storytelling","emotional","documentary","podcast"]', 'Warm, grounded storyteller — excellent for 10–30 minute narration.', '["Biographies","Human-interest stories","Emotional stories","Long-form videos"]', 9.5, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('finley', 'Finley', 'en', 'masculine', NULL, '["articulate","professional","authoritative","informative"]', '["documentary","business_finance","educational","technology_ai","news"]', 'Articulate professional narrator for documentary, history and explainers.', '["History","Science","Business","News-style narration"]', 9.4, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('jade', 'Jade', 'en', 'feminine', NULL, '["energetic","modern","friendly","upbeat"]', '["lifestyle_beauty","shorts_reels","entertainment","conversational"]', 'Energetic modern voice for Shorts, Reels and social content.', '["Beauty","Lifestyle","Social media","UGC-style content"]', 9.3, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('elara', 'Elara', 'en', 'feminine', NULL, '["clear","professional","modern","crisp"]', '["technology_ai","educational","documentary","conversational"]', 'Crisp professional voice for tech, AI and product explainers.', '["SaaS","Tutorials","Product explainers","Education"]', 9.2, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('talia', 'Talia', 'en', 'feminine', NULL, '["warm","soft","friendly","calm"]', '["lifestyle_beauty","soft_calm","educational","storytelling"]', 'Warm, soft narrator for wellness, lifestyle and calm storytelling.', '["Wellness","Meditation","Beauty","Soft storytelling"]', 9.1, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('lawrence', 'Lawrence', 'en', 'masculine', NULL, '["bright","informative","clear"]', '["educational","technology_ai","shorts_reels","news"]', 'Bright, informative voice for tutorials and fact content.', '["Tutorials","Facts","Educational Shorts","Informational videos"]', 9, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('warren', 'Warren', 'en', 'masculine', NULL, '["casual","young","cool","natural"]', '["shorts_reels","entertainment","conversational"]', 'Casual creator-style narrator for entertainment and social video.', '["Entertainment","Conversational videos","Social content","Shorts"]', 8.9, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('florence', 'Florence', 'en', 'feminine', NULL, '["atmospheric","emotional","cinematic","soft"]', '["emotional","storytelling","cinematic","crime_mystery"]', 'Atmospheric, emotional narrator for romance, mystery and audiobook-style stories.', '["Emotional storytelling","Romance","Mystery","Fantasy","Female narration"]', 8.8, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('niraj', 'Niraj', 'hi', 'masculine', NULL, '["smooth","emotional","cinematic","warm"]', '["storytelling","emotional","cinematic","motivational","soft_calm"]', 'Smooth, emotional cinematic narrator — the default Hindi storyteller.', '["Village stories","Dramatic stories","Emotional stories","Romance","Motivational videos"]', 9.7, TRUE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('raju', 'Raju', 'hi', 'masculine', NULL, '["natural","warm","human","friendly"]', '["storytelling","documentary","soft_calm","educational"]', 'Natural, warm human narrator for stories that feel personal.', '["Moral stories","Documentary","Long-form narration","Educational"]', 9.5, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('aakash', 'Aakash', 'hi', 'masculine', NULL, '["professional","narrative","balanced"]', '["storytelling","documentary","educational","podcast"]', 'Professional, balanced narrator for long-form Hindi content.', '["Audiobooks","Hindi explainers","Documentary","Educational narration"]', 9.4, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('bunty', 'Bunty', 'hi', 'masculine', NULL, '["punchy","fast","energetic","attention-grabbing"]', '["shorts_reels","entertainment","news","conversational"]', 'Punchy, fast voice built for viral Hindi Shorts and Reels.', '["Shorts","Reels","Viral hooks","Facts","Fast storytelling"]', 9.3, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('monika-sogam', 'Monika Sogam', 'hi', 'feminine', NULL, '["warm","calm","natural"]', '["emotional","storytelling","lifestyle_beauty","educational"]', 'Warm, calm natural female narrator.', '["Emotional stories","Lifestyle","Education","Female narration"]', 9.2, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('kali-devi', 'Kali Devi', 'hi', 'feminine', NULL, '["expressive","cinematic"]', '["emotional","cinematic","storytelling"]', 'Expressive cinematic female storyteller.', '["Emotional stories","Dramatic narration","Cultural stories","Cinematic content"]', 9.1, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('krishna-gupta', 'Krishna Gupta', 'hi', 'masculine', NULL, '["modern","energetic","social-media friendly"]', '["shorts_reels","entertainment","news","conversational"]', 'Modern, energetic voice for Hindi social media.', '["Shorts","Reels","Facts","Entertainment","Social media"]', 9, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('devi', 'Devi', 'hi', 'feminine', NULL, '["positive","warm","motivating"]', '["motivational","educational","soft_calm","storytelling"]', 'Positive, warm motivating narrator.', '["Motivational videos","Positive stories","Education","Wellness"]', 8.9, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('vikram', 'Vikram', 'hi', 'masculine', NULL, '["clear","professional","informative"]', '["educational","technology_ai","news","conversational"]', 'Clear, professional voice for Hindi tutorials and explainers.', '["Tutorials","Education","Technology","Informational videos"]', 8.8, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('vikrant', 'Vikrant', 'hi', 'masculine', NULL, '["direct","clear","instructional"]', '["educational","technology_ai","conversational"]', 'Direct, instructional narrator for how-to content.', '["How-to videos","Education","Tutorials","Tech"]', 8.7, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('miguel', 'Miguel', 'es', 'masculine', NULL, '["deep","rich","cinematic","dramatic"]', '["cinematic","documentary","crime_mystery","emotional","storytelling"]', 'Deep, rich cinematic narrator — the default Spanish storyteller.', '["Documentary","Mystery","Crime","History","Emotional storytelling"]', 9.8, TRUE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('alberto-rodriguez', 'Alberto Rodríguez', 'es', 'masculine', NULL, '["serious","professional","narrative"]', '["documentary","business_finance","crime_mystery","storytelling"]', 'Serious, professional narrator for long-form Spanish content.', '["Biography","Business","History","True crime"]', 9.7, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('david-martin', 'David Martin', 'es', 'masculine', NULL, '["confident","balanced","professional"]', '["documentary","educational","business_finance","storytelling"]', 'Confident, balanced professional narrator.', '["Educational","Business","General storytelling","Spain-focused narration"]', 9.5, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('carmelo', 'Carmelo', 'es', 'masculine', NULL, '["mature","mysterious","dark","clear"]', '["horror","crime_mystery","documentary"]', 'Mature, mysterious voice for dark Spanish storytelling.', '["Horror","Mystery","Crime","Dark history","Suspense"]', 9.4, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('fernando-martinez', 'Fernando Martínez', 'es', 'masculine', NULL, '["fast","persuasive","energetic"]', '["shorts_reels","entertainment","news","conversational"]', 'Fast, persuasive voice for high-energy Spanish content.', '["Shorts","Reels","Advertising","Facts","Fast-paced videos"]', 9.3, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('enrique-mondragon', 'Enrique Mondragón', 'es', 'masculine', 'Mexican Spanish', '["natural","narrative"]', '["storytelling","documentary","entertainment","podcast"]', 'Natural Mexican Spanish narrator.', '["Mexican storytelling","Documentary","Entertainment","Long-form videos"]', 9.2, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('antonio', 'Antonio', 'es', 'masculine', 'Mexican Spanish', '["conversational","friendly","casual"]', '["conversational","podcast","entertainment","shorts_reels"]', 'Friendly, casual Mexican Spanish conversationalist.', '["Podcasts","Entertainment","Social videos","Conversational content"]', 9.1, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('agustin', 'Agustín', 'es', 'masculine', 'Argentine', '["relaxed","conversational"]', '["conversational","entertainment","podcast"]', 'Relaxed Argentine conversational narrator.', '["Casual storytelling","Entertainment","Podcasts","Social content"]', 9, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('sara-martin', 'Sara Martin', 'es', 'feminine', NULL, '["clear","professional","friendly"]', '["educational","documentary","lifestyle_beauty","conversational"]', 'Clear, professional friendly female voice.', '["Education","Documentary","Lifestyle","Female narration"]', 8.9, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('el-faraon', 'El Faraon', 'es', 'masculine', 'Latin-American', '["deep","strong"]', '["storytelling","motivational","cinematic","documentary"]', 'Deep, strong Latin-American narrator.', '["History","Motivational","Cinematic narration","Storytelling"]', 8.8, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('leon-stern', 'Leon Stern', 'de', 'masculine', NULL, '["rich","deep","cinematic","authoritative"]', '["documentary","crime_mystery","business_finance","cinematic","storytelling"]', 'Rich, deep cinematic narrator — the default German storyteller.', '["Documentary","History","Crime","Mystery","Business"]', 9.7, TRUE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('helmut-stieglbauer', 'Helmut Stieglbauer', 'de', 'masculine', NULL, '["deep","dynamic","dramatic"]', '["documentary","crime_mystery","cinematic","storytelling"]', 'Deep, dynamic dramatic narrator.', '["History","Crime","Cinematic","Dramatic storytelling"]', 9.6, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('christian', 'Christian', 'de', 'masculine', NULL, '["warm","captivating","natural"]', '["storytelling","documentary","educational","conversational"]', 'Warm, captivating natural narrator.', '["Long-form storytelling","Biography","Travel","Educational stories"]', 9.5, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('otto', 'Otto', 'de', 'masculine', NULL, '["casual","natural","creator-like"]', '["conversational","entertainment","shorts_reels","educational"]', 'Casual, creator-like German narrator.', '["YouTube narration","Conversational videos","Explainers","Shorts"]', 9.4, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('mila', 'Mila', 'de', 'feminine', NULL, '["confident","professional"]', '["documentary","news","educational","shorts_reels"]', 'Confident professional female narrator.', '["Documentary","Commentary","News","Educational"]', 9.3, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('benjamin', 'Benjamin', 'de', 'masculine', NULL, '["clear","educational","professional"]', '["educational","technology_ai","conversational"]', 'Clear, professional voice for German education and tech.', '["Education","Tutorials","Explainers","Technology"]', 9.1, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('toby', 'Toby', 'de', 'masculine', NULL, '["casual","friendly","conversational"]', '["entertainment","podcast","conversational"]', 'Casual, friendly conversational narrator.', '["Entertainment","Podcasts","Casual storytelling","Social content"]', 9, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('sissi', 'Sissi', 'de', 'feminine', NULL, '["energetic","expressive"]', '["shorts_reels","lifestyle_beauty","entertainment"]', 'Energetic, expressive female voice.', '["Shorts","Reels","Lifestyle","Entertainment"]', 8.9, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('elli', 'Elli', 'de', 'feminine', NULL, '["friendly","soft","conversational"]', '["lifestyle_beauty","educational","conversational","storytelling"]', 'Friendly, soft conversational narrator.', '["Lifestyle","Education","Conversational videos","Female storytelling"]', 8.8, FALSE, 'elevenlabs', 'MF3mGyEYCl7XYWb3QV9V', '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'mapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
INSERT INTO public.voice_characters (id, name, language_code, gender, accent, personality_tags, category_tags, description, recommended_for, score, is_default, provider, provider_voice_id, supported_models, status) VALUES ('thorsten', 'Thorsten', 'de', 'masculine', NULL, '["expressive","character-driven"]', '["entertainment","storytelling","conversational"]', 'Expressive, character-driven narrator.', '["Animation","Characters","Comedy","Storytelling"]', 8.7, FALSE, 'elevenlabs', NULL, '["eleven_multilingual_v2","eleven_flash_v2_5","eleven_turbo_v2_5","eleven_v3"]', 'unmapped') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language_code = EXCLUDED.language_code, gender = EXCLUDED.gender, accent = EXCLUDED.accent, personality_tags = EXCLUDED.personality_tags, category_tags = EXCLUDED.category_tags, description = EXCLUDED.description, recommended_for = EXCLUDED.recommended_for, score = EXCLUDED.score, is_default = EXCLUDED.is_default, provider = EXCLUDED.provider, supported_models = EXCLUDED.supported_models;
