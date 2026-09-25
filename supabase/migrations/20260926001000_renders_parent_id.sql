-- Sprint 5-6: parent linkage for derived renders (dubbing + shorts).
--
-- A dub or a Short is a NEW renders row that derives from a finished
-- render. `parent_id` records that lineage so the UI can show
-- "dub of / short of" and the owner policy keeps protecting children
-- through the same renders RLS policy.
--
-- Non-destructive: ADD COLUMN IF NOT EXISTS only; no drops, no rewrites.
-- Self-referential FK with ON DELETE SET NULL (a deleted source never
-- cascades into its dubs/shorts).

alter table public.renders
  add column if not exists parent_id uuid
  references public.renders(id) on delete set null;

create index if not exists renders_parent_idx
  on public.renders (parent_id)
  where parent_id is not null;

comment on column public.renders.parent_id is
  'Sprint 5-6: source render this row derives from (dub or short). NULL for original renders.';
