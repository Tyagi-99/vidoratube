-- Phase 1 (Foundation) — Creation domain.
--
-- RECONCILIATION (D88: extend, don't migrate). All tables below were verified
-- MISSING from supabase/migrations (36 files, latest 20260926050000):
--   folders, folder_rules, folder_items, scripts, script_versions,
--   brand_profiles, voices, scene_versions, thumbnail_projects,
--   title_variants, content_packages.
-- Near-duplicates inspected and deliberately NOT duplicated:
--   * thumbnails (exists): one row per (project_id, variant, aspect) with
--     prompt/provider/model/license/selected — it IS the canonical thumbnail
--     variant store (plan's `thumbnail_variants`). `thumbnail_projects` below
--     is the layered-editor project surface that GROUPS those variant rows
--     (documented in 20260928020400_p1_extensions.sql). No parallel table.
--   * brand_kits (exists): workspace-scoped VISUAL identity (logo, colors,
--     font). `brand_profiles` below is the WRITING voice profile (tone,
--     vocabulary, persona) for F13 Brand Voice. Different domain — new table.
--   * language_voices (exists): shared PUBLIC catalog of provider voice
--     slots (no user data, public read by design). `voices` below is the
--     per-user voice asset registry (uploads, clones, assignments).
--     Different domain — new table.
--   * seo_metadata (exists): per-project SEO blob with titles jsonb.
--     `title_variants` below is the stats-disciplined variant store with
--     per-variant impressions/CTR and experiment linkage. New table.
--   * scenes (exists): `scene_versions` adds the version history scenes lack.
--
-- Forward-only, non-destructive: CREATE TABLE IF NOT EXISTS only.

-- ── folders / folder_rules / folder_items (F7 Smart Folders) ─────────────
CREATE TABLE IF NOT EXISTS public.folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS public.folder_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id uuid NOT NULL REFERENCES public.folders(id) ON DELETE CASCADE,
  -- field/operator/value: e.g. {field:'outlier_score', operator:'gte', value:2.0}.
  -- value is jsonb so rules can compare numbers, strings, or string lists.
  field text NOT NULL,
  operator text NOT NULL
    CHECK (operator IN ('eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in')),
  value jsonb NOT NULL DEFAULT 'null'::jsonb,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS folder_rules_folder_idx ON public.folder_rules (folder_id, position);

CREATE TABLE IF NOT EXISTS public.folder_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id uuid NOT NULL REFERENCES public.folders(id) ON DELETE CASCADE,
  -- Polymorphic reference by design: item_type names the table
  -- (videos, video_ideas, research_sources, ...), item_id its row.
  item_type text NOT NULL,
  item_id uuid NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (folder_id, item_type, item_id)
);
CREATE INDEX IF NOT EXISTS folder_items_folder_idx ON public.folder_items (folder_id, added_at DESC);

COMMENT ON TABLE public.folders IS
  'Phase 1 (F7): smart folders — dynamic, rule-based collections across research assets.';
COMMENT ON TABLE public.folder_items IS
  'Phase 1 (F7): pinned/manual folder membership. item_type + item_id is polymorphic by design (cross-table references cannot be a single FK).';

-- ── scripts / script_versions (F12 Script Studio) ────────────────────────
CREATE TABLE IF NOT EXISTS public.scripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Untitled script',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'in_review', 'approved', 'locked')),
  -- current_version_id FK added after script_versions exists (see below).
  current_version_id uuid,
  word_count integer NOT NULL DEFAULT 0,
  brand_profile_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scripts_project_idx ON public.scripts (project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.script_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id uuid NOT NULL REFERENCES public.scripts(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  -- sections: [{ heading, body, est_seconds, ... }] — the section-based editor.
  sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  full_text text NOT NULL DEFAULT '',
  word_count integer NOT NULL DEFAULT 0,
  -- timing: per-section narration timing for caption/voiceover planning.
  timing jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  change_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (script_id, version_number)
);
CREATE INDEX IF NOT EXISTS script_versions_script_idx
  ON public.script_versions (script_id, version_number DESC);

-- scripts.current_version_id and scripts.brand_profile_id FKs (guarded so the
-- migration is re-runnable; inline REFERENCES would fail on first run
-- because the referenced tables are created later in this file/batch).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scripts_current_version_fk') THEN
    ALTER TABLE public.scripts
      ADD CONSTRAINT scripts_current_version_fk
      FOREIGN KEY (current_version_id) REFERENCES public.script_versions(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON TABLE public.scripts IS
  'Phase 1 (F12): script documents with version history. NOTE: projects.script (text) is the legacy single-blob column; scripts is the canonical store going forward.';

-- ── brand_profiles (F13 Brand Voice) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.brand_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  tone text NOT NULL DEFAULT '',
  vocabulary jsonb NOT NULL DEFAULT '{}'::jsonb,
  persona text NOT NULL DEFAULT '',
  do_list text[] NOT NULL DEFAULT '{}',
  dont_list text[] NOT NULL DEFAULT '{}',
  sample_text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

COMMENT ON TABLE public.brand_profiles IS
  'Phase 1 (F13): writing-voice profiles bound to script generation. Distinct from brand_kits (visual identity: logo/colors/font).';

-- scripts.brand_profile_id FK (brand_profiles now exists).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scripts_brand_profile_fk') THEN
    ALTER TABLE public.scripts
      ADD CONSTRAINT scripts_brand_profile_fk
      FOREIGN KEY (brand_profile_id) REFERENCES public.brand_profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── voices (F17 Voice Studio) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.voices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  provider text NOT NULL
    CHECK (provider IN ('elevenlabs', 'openai', 'gateway', 'upload', 'none')),
  provider_voice_id text,
  voice_type text NOT NULL DEFAULT 'builtin'
    CHECK (voice_type IN ('builtin', 'uploaded', 'cloned')),
  language_code text REFERENCES public.languages(code) ON DELETE SET NULL,
  -- verified: the provider id was checked against a real provider (D37 rule:
  -- never invent ids). Cloned voices additionally require is_clone_legal.
  verified boolean NOT NULL DEFAULT false,
  is_clone_legal boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

COMMENT ON TABLE public.voices IS
  'Phase 1 (F17): per-user voice assets (uploads, legal clones, provider assignments). Distinct from language_voices (shared public catalog of provider slots).';

-- ── scene_versions (F20 Video Studio) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.scene_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id uuid NOT NULL REFERENCES public.scenes(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  narration text NOT NULL DEFAULT '',
  visual_prompt text,
  asset_url text,
  change_note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scene_id, version_number)
);
CREATE INDEX IF NOT EXISTS scene_versions_scene_idx
  ON public.scene_versions (scene_id, version_number DESC);

COMMENT ON TABLE public.scene_versions IS
  'Phase 1 (F20): per-scene version history backing per-scene regen/repair. The live scene row in scenes is the mutable head.';

-- ── thumbnail_projects (F15 Thumbnail Studio) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.thumbnail_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Thumbnail set',
  -- canvas: layered-editor state { layers: [...], background, ... }.
  canvas jsonb NOT NULL DEFAULT '{}'::jsonb,
  width integer NOT NULL DEFAULT 1280 CHECK (width > 0),
  height integer NOT NULL DEFAULT 720 CHECK (height > 0),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'in_review', 'approved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS thumbnail_projects_project_idx
  ON public.thumbnail_projects (project_id, updated_at DESC);

COMMENT ON TABLE public.thumbnail_projects IS
  'Phase 1 (F15): layered thumbnail editor projects. Variant RENDERS live in public.thumbnails (one row per project_id/variant/aspect) — this table is the design surface, not a parallel variant store.';

-- ── title_variants (F14 Title Lab) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.title_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  -- score: stats-disciplined breakdown { length, keyword, curiosity, clarity, total }.
  score jsonb NOT NULL DEFAULT '{}'::jsonb,
  impressions integer NOT NULL DEFAULT 0 CHECK (impressions >= 0),
  ctr numeric CHECK (ctr IS NULL OR (ctr >= 0 AND ctr <= 1)),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'testing', 'winner', 'retired')),
  -- experiment_id FK added in 20260928020200 (experiments table lives there).
  experiment_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS title_variants_project_idx
  ON public.title_variants (project_id, status);

COMMENT ON TABLE public.title_variants IS
  'Phase 1 (F14): stats-disciplined title variants with per-variant impressions/CTR and experiment linkage. seo_metadata.titles (jsonb blob) stays the legacy per-project SEO record.';

-- ── content_packages (F25 Idea → Campaign) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.content_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  -- idea_id FK to video_ideas added in 20260928020400 (extension batch).
  idea_id uuid,
  name text NOT NULL DEFAULT 'Campaign package',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'in_production', 'ready', 'published', 'archived')),
  -- formats: e.g. ['longform', 'shorts', 'thumbnail', 'community_post'].
  formats text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_packages_project_idx
  ON public.content_packages (project_id, updated_at DESC);

COMMENT ON TABLE public.content_packages IS
  'Phase 1 (F25): one idea → multi-format campaign (long + shorts + thumbnails + titles).';

-- ── RLS: owner-scoped everywhere ─────────────────────────────────────────
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folder_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folder_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.script_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scene_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.thumbnail_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.title_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS folders_owner ON public.folders;
CREATE POLICY folders_owner ON public.folders
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS folder_rules_owner ON public.folder_rules;
CREATE POLICY folder_rules_owner ON public.folder_rules
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.folders f
            WHERE f.id = folder_rules.folder_id AND f.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.folders f
            WHERE f.id = folder_rules.folder_id AND f.user_id = auth.uid())
  );

DROP POLICY IF EXISTS folder_items_owner ON public.folder_items;
CREATE POLICY folder_items_owner ON public.folder_items
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.folders f
            WHERE f.id = folder_items.folder_id AND f.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.folders f
            WHERE f.id = folder_items.folder_id AND f.user_id = auth.uid())
  );

DROP POLICY IF EXISTS scripts_owner ON public.scripts;
CREATE POLICY scripts_owner ON public.scripts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS script_versions_owner ON public.script_versions;
CREATE POLICY script_versions_owner ON public.script_versions
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.scripts s
            WHERE s.id = script_versions.script_id AND s.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.scripts s
            WHERE s.id = script_versions.script_id AND s.user_id = auth.uid())
  );

DROP POLICY IF EXISTS brand_profiles_owner ON public.brand_profiles;
CREATE POLICY brand_profiles_owner ON public.brand_profiles
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS voices_owner ON public.voices;
CREATE POLICY voices_owner ON public.voices
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS scene_versions_owner ON public.scene_versions;
CREATE POLICY scene_versions_owner ON public.scene_versions
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.scenes s
            WHERE s.id = scene_versions.scene_id AND s.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.scenes s
            WHERE s.id = scene_versions.scene_id AND s.user_id = auth.uid())
  );

DROP POLICY IF EXISTS thumbnail_projects_owner ON public.thumbnail_projects;
CREATE POLICY thumbnail_projects_owner ON public.thumbnail_projects
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS title_variants_owner ON public.title_variants;
CREATE POLICY title_variants_owner ON public.title_variants
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS content_packages_owner ON public.content_packages;
CREATE POLICY content_packages_owner ON public.content_packages
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- RESTRICTIVE "No guest sessions" on every new table (mirrors the pattern
-- from migration 20260925112402; new tables carry their own copy).
DO $$
DECLARE
  t text;
  tbls text[] := ARRAY[
    'folders', 'folder_rules', 'folder_items', 'scripts', 'script_versions',
    'brand_profiles', 'voices', 'scene_versions', 'thumbnail_projects',
    'title_variants', 'content_packages'
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

-- updated_at triggers
DROP TRIGGER IF EXISTS folders_touch_updated_at ON public.folders;
CREATE TRIGGER folders_touch_updated_at BEFORE UPDATE ON public.folders
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS scripts_touch_updated_at ON public.scripts;
CREATE TRIGGER scripts_touch_updated_at BEFORE UPDATE ON public.scripts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS brand_profiles_touch_updated_at ON public.brand_profiles;
CREATE TRIGGER brand_profiles_touch_updated_at BEFORE UPDATE ON public.brand_profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS voices_touch_updated_at ON public.voices;
CREATE TRIGGER voices_touch_updated_at BEFORE UPDATE ON public.voices
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS thumbnail_projects_touch_updated_at ON public.thumbnail_projects;
CREATE TRIGGER thumbnail_projects_touch_updated_at BEFORE UPDATE ON public.thumbnail_projects
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS title_variants_touch_updated_at ON public.title_variants;
CREATE TRIGGER title_variants_touch_updated_at BEFORE UPDATE ON public.title_variants
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS content_packages_touch_updated_at ON public.content_packages;
CREATE TRIGGER content_packages_touch_updated_at BEFORE UPDATE ON public.content_packages
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
