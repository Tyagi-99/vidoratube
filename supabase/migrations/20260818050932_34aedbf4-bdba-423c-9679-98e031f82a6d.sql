CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;

CREATE TABLE public.categories (
  id uuid primary key default gen_random_uuid(),
  group_name text not null,
  name text not null,
  slug text not null unique,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
GRANT SELECT ON public.categories TO authenticated, anon;
GRANT ALL ON public.categories TO service_role;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "categories_read" ON public.categories FOR SELECT TO authenticated, anon USING (true);

CREATE TABLE public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid references public.video_jobs(id) on delete set null,
  title text not null default 'Untitled project',
  topic text not null default '',
  script text,
  mode text not null default 'stock',
  category text,
  preset text not null default 'documentary',
  visual_style text not null default 'cinematic_realistic',
  language text not null default 'English',
  duration_minutes int not null default 5,
  aspect_ratio text not null default '16:9',
  status text not null default 'draft',
  stage text not null default 'created',
  step text not null default 'Ready to generate',
  error text,
  narration text,
  visual_bible jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  audio_url text,
  thumbnail_url text,
  result_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "projects_own" ON public.projects FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner'))
  WITH CHECK (auth.uid() = user_id);
CREATE INDEX projects_user_idx ON public.projects(user_id, created_at desc);

CREATE TABLE public.scenes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  scene_number int not null,
  narration text not null default '',
  duration numeric not null default 15,
  visual_type text not null default 'STOCK_IMAGE',
  visual_prompt text,
  negative_prompt text,
  search_query text,
  style_override text,
  asset_url text,
  asset_thumb_url text,
  asset_source jsonb not null default '{}'::jsonb,
  transition text not null default 'crossfade',
  motion_type text not null default 'slow_zoom',
  status text not null default 'pending',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, scene_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scenes TO authenticated;
GRANT ALL ON public.scenes TO service_role;
ALTER TABLE public.scenes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scenes_own" ON public.scenes FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner'))
  WITH CHECK (auth.uid() = user_id);
CREATE INDEX scenes_project_idx ON public.scenes(project_id, scene_number);

CREATE TABLE public.voiceovers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  scene_id uuid references public.scenes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  audio_url text,
  duration numeric,
  characters int not null default 0,
  voice_id text,
  model text,
  cache_key text,
  created_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.voiceovers TO authenticated;
GRANT ALL ON public.voiceovers TO service_role;
ALTER TABLE public.voiceovers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "voiceovers_own" ON public.voiceovers FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner'))
  WITH CHECK (auth.uid() = user_id);
CREATE INDEX voiceovers_scene_idx ON public.voiceovers(scene_id);

CREATE TABLE public.captions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  scene_id uuid references public.scenes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  cues jsonb not null default '[]'::jsonb,
  style text not null default 'documentary',
  created_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.captions TO authenticated;
GRANT ALL ON public.captions TO service_role;
ALTER TABLE public.captions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "captions_own" ON public.captions FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner'))
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.api_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  provider text not null,
  operation text not null,
  units numeric not null default 1,
  estimated_cost numeric not null default 0,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
GRANT SELECT, INSERT ON public.api_usage TO authenticated;
GRANT ALL ON public.api_usage TO service_role;
ALTER TABLE public.api_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "api_usage_own" ON public.api_usage FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner'));
CREATE POLICY "api_usage_insert" ON public.api_usage FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER projects_updated_at BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER scenes_updated_at BEFORE UPDATE ON public.scenes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.categories (group_name, name, slug, sort_order) VALUES
('History & Documentary','Ancient Civilizations','ancient-civilizations',1),
('History & Documentary','Medieval History','medieval-history',2),
('History & Documentary','Roman Empire','roman-empire',3),
('History & Documentary','Ancient Egypt','ancient-egypt',4),
('History & Documentary','Ancient Greece','ancient-greece',5),
('History & Documentary','World History','world-history',6),
('History & Documentary','Historical Events','historical-events',7),
('History & Documentary','Historical Places','historical-places',8),
('History & Documentary','Historical Technology','historical-technology',9),
('History & Documentary','Daily Life in History','daily-life-in-history',10),
('War & Military','Military History','military-history',11),
('War & Military','Famous Battles','famous-battles',12),
('War & Military','World War I','world-war-i',13),
('War & Military','World War II','world-war-ii',14),
('War & Military','Ancient Warfare','ancient-warfare',15),
('War & Military','Medieval Warfare','medieval-warfare',16),
('War & Military','Naval Warfare','naval-warfare',17),
('War & Military','Military Technology','military-technology',18),
('War & Military','Strategy & Battles','strategy-and-battles',19),
('War & Military','Rise and Fall of Empires','rise-and-fall-of-empires',20),
('Sleep / Boring History','Boring History','boring-history',21),
('Sleep / Boring History','Sleepy History','sleepy-history',22),
('Sleep / Boring History','Slow Historical Stories','slow-historical-stories',23),
('Sleep / Boring History','Everyday Life in the Past','everyday-life-in-the-past',24),
('Sleep / Boring History','Ancient Daily Life','ancient-daily-life',25),
('Sleep / Boring History','Forgotten Places','forgotten-places',26),
('Sleep / Boring History','Forgotten People','forgotten-people',27),
('Sleep / Boring History','Long Historical Narratives','long-historical-narratives',28),
('Mystery','Ancient Mysteries','ancient-mysteries',29),
('Mystery','Unsolved Historical Events','unsolved-historical-events',30),
('Mystery','Lost Civilizations','lost-civilizations',31),
('Mystery','Forgotten Cities','forgotten-cities',32),
('Mystery','Historical Mysteries','historical-mysteries',33),
('Geography','Countries','geo-countries',34),
('Geography','Cities','geo-cities',35),
('Geography','Mountains','geo-mountains',36),
('Geography','Oceans','geo-oceans',37),
('Geography','Rivers','geo-rivers',38),
('Geography','Ancient Trade Routes','ancient-trade-routes',39),
('Geography','Borders & Empires','borders-and-empires',40),
('Nature / Relaxation','Rain','nature-rain',41),
('Nature / Relaxation','Forests','nature-forests',42),
('Nature / Relaxation','Oceans','nature-oceans',43),
('Nature / Relaxation','Mountains','nature-mountains',44),
('Nature / Relaxation','Night Landscapes','nature-night',45),
('Nature / Relaxation','Space','nature-space',46),
('Nature / Relaxation','Calm Landscapes','nature-calm',47),
('Educational','Science','edu-science',48),
('Educational','Technology','edu-technology',49),
('Educational','Economics','edu-economics',50),
('Educational','Psychology','edu-psychology',51),
('Educational','Geography','edu-geography',52),
('Educational','General Knowledge','edu-general',53),
('Travel','Countries','travel-countries',54),
('Travel','Cities','travel-cities',55),
('Travel','Historical Sites','travel-historical-sites',56),
('Travel','Ancient Locations','travel-ancient-locations',57),
('Travel','Cultural Places','travel-cultural-places',58);