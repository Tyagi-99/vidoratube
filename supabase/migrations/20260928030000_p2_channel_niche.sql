-- Phase 2 (Stream A): link tracked channels to niches.
--
-- The Phase 2 contract requires trackChannel({ externalChannelId, nicheId? })
-- and listChannels({ nicheId? }) on the intelligence channel registry, but the
-- Phase 1 `channels` table has no niche association. This adds it.
-- Forward-only, non-destructive: ADD COLUMN IF NOT EXISTS only. No RLS change
-- needed (column inherits the table's existing owner policies).

ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS niche_id uuid REFERENCES public.niches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS channels_niche_idx ON public.channels (niche_id);

COMMENT ON COLUMN public.channels.niche_id IS
  'Phase 2 (Stream A): optional niche this tracked channel belongs to. Powers trackChannel/listChannels niche filtering.';
