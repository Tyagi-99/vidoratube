-- P4: Studio v2 creative upgrades — characters, music tracks, asset provenance.
--
-- characters: user-defined recurring characters for visual consistency.
-- music_tracks: cached royalty-free tracks from Pixabay Music API.
-- asset_provenance: append-only record of every generated asset's origin.

-- ---------------------------------------------------------------------------
-- characters
-- ---------------------------------------------------------------------------
create table public.characters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '' check (char_length(description) <= 2000),
  reference_image_url text check (char_length(reference_image_url) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.characters enable row level security;

create policy "characters_owner_all"
  on public.characters for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- music_tracks (curated cache; rows are shared catalog, user picks per project)
-- ---------------------------------------------------------------------------
create table public.music_tracks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  artist text not null default 'Unknown artist',
  mood text not null check (mood in ('uplifting', 'tense', 'calm', 'epic', 'playful')),
  provider text not null default 'jamendo',
  provider_track_id text,
  preview_url text,
  download_url text,
  license text not null default 'Creative Commons (see license_url)',
  license_url text,
  duration_secs numeric,
  created_at timestamptz not null default now(),
  unique (provider, provider_track_id)
);

alter table public.music_tracks enable row level security;

-- Read-only catalog for all authenticated users; writes are service-role only
-- (populated by the Jamendo sync server function).
create policy "music_tracks_read_all"
  on public.music_tracks for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- asset_provenance (append-only)
-- ---------------------------------------------------------------------------
create table public.asset_provenance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  scene_id uuid references public.scenes(id) on delete set null,
  kind text not null check (kind in ('image', 'voice', 'music', 'video', 'thumbnail', 'caption')),
  provider text not null,
  model text,
  prompt text,
  seed text,
  license text,
  license_url text,
  cost_credits numeric not null default 0,
  asset_url text,
  created_at timestamptz not null default now()
);

alter table public.asset_provenance enable row level security;

create policy "asset_provenance_owner_read"
  on public.asset_provenance for select
  using (auth.uid() = user_id);

-- Inserts happen service-role side after generation; no direct user writes.
-- (No insert/update/delete policies for authenticated = denied by default.)

create index asset_provenance_scene_idx
  on public.asset_provenance (scene_id, created_at desc);

create index asset_provenance_project_idx
  on public.asset_provenance (project_id, created_at desc);

-- ---------------------------------------------------------------------------
-- scenes: per-scene character + voice override
-- ---------------------------------------------------------------------------
alter table public.scenes
  add column if not exists character_id uuid references public.characters(id) on delete set null,
  add column if not exists voice_id text check (char_length(voice_id) <= 120);

-- ---------------------------------------------------------------------------
-- projects: music selection
-- ---------------------------------------------------------------------------
alter table public.projects
  add column if not exists music_track_id uuid references public.music_tracks(id) on delete set null,
  add column if not exists music_volume numeric not null default 0.15 check (music_volume >= 0 and music_volume <= 1),
  add column if not exists music_ducking boolean not null default true;

-- updated_at triggers
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists characters_touch on public.characters;
create trigger characters_touch
  before update on public.characters
  for each row execute function public.touch_updated_at();
