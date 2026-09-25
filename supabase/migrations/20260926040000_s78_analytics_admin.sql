-- Sprint 7-8 (workstream D): analytics + admin metrics storage.
--
-- Three new owner-scoped tables:
--   1. platform_video_stats  — per-video, per-platform stats snapshots
--      (views/likes/comments/watch_time as JSONB). Powers the 24h and 7d
--      views views computed from snapshot deltas.
--   2. retention_curves      — per-segment audience-retention points for one
--      video, aligned to chapter titles when the render's chapters carry
--      real paragraph durations.
--   3. nps_responses         — in-app NPS prompt answers (score 0-10 +
--      optional comment).
--
-- Non-destructive: CREATE TABLE IF NOT EXISTS only; no drops, no rewrites,
-- no changes to existing tables. RLS enabled with the standard owner policy
-- (auth.uid() = user_id), matching every other user-data table.
-- Writes from the app go through server functions with the service role or
-- the caller's own JWT; no public/anon access.

-- 1. Per-video platform stats snapshots -------------------------------------

create table if not exists public.platform_video_stats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  publish_job_id uuid references public.publish_jobs(id) on delete set null,
  youtube_video_id text not null,
  platform text not null default 'youtube',
  captured_at timestamptz not null default now(),
  snapshot_date date not null default (now()::date),
  -- { views, likes, comments, watch_time_minutes, ... } — additive only.
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (youtube_video_id, platform, snapshot_date)
);

create index if not exists platform_video_stats_user_idx
  on public.platform_video_stats (user_id);
create index if not exists platform_video_stats_video_idx
  on public.platform_video_stats (youtube_video_id, platform);

comment on table public.platform_video_stats is
  'Sprint 7-8: per-video platform stats snapshots (views/likes/comments/watch_time in metrics JSONB). 24h/7d views are computed from snapshot deltas, never fabricated.';
comment on column public.platform_video_stats.metrics is
  'Additive JSONB: { views, likes, comments, watch_time_minutes, ... }.';

-- 2. Retention curves --------------------------------------------------------

create table if not exists public.retention_curves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  publish_job_id uuid references public.publish_jobs(id) on delete set null,
  youtube_video_id text not null,
  captured_at timestamptz not null default now(),
  snapshot_date date not null default (now()::date),
  -- segments: [{ index, title, start_sec, end_sec }] — chapter-aligned only
  -- when render_chapters carry real paragraph durations; NULL otherwise.
  segments jsonb,
  -- points: [{ t: elapsed seconds, r: 0-100 audienceWatchRatio }]
  points jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (youtube_video_id, snapshot_date)
);

create index if not exists retention_curves_user_idx
  on public.retention_curves (user_id);
create index if not exists retention_curves_video_idx
  on public.retention_curves (youtube_video_id);

comment on table public.retention_curves is
  'Sprint 7-8: per-video audience-retention curves stored as JSONB points, optionally aligned to chapter titles. Empty when no retention data exists — never backfilled with estimates.';

-- 3. NPS responses ----------------------------------------------------------

create table if not exists public.nps_responses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  score integer not null check (score >= 0 and score <= 10),
  comment text,
  context text not null default 'in_app',
  created_at timestamptz not null default now()
);

create index if not exists nps_responses_user_idx
  on public.nps_responses (user_id);
create index if not exists nps_responses_created_idx
  on public.nps_responses (created_at desc);

comment on table public.nps_responses is
  'Sprint 7-8: in-app NPS prompt answers (0-10 score + optional comment). One row per response; users can answer again on later prompts.';

-- RLS -----------------------------------------------------------------------

alter table public.platform_video_stats enable row level security;
alter table public.retention_curves enable row level security;
alter table public.nps_responses enable row level security;

drop policy if exists platform_video_stats_owner on public.platform_video_stats;
create policy platform_video_stats_owner on public.platform_video_stats
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists retention_curves_owner on public.retention_curves;
create policy retention_curves_owner on public.retention_curves
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists nps_responses_owner on public.nps_responses;
create policy nps_responses_owner on public.nps_responses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
