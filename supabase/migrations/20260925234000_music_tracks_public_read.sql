-- Sprint 3-4 item 6: music_tracks RLS hardening.
--
-- Lovable's pre-publish scan flags USING (auth.uid() IS NOT NULL) as
-- effectively public while anonymous sign-ins are enabled. music_tracks is a
-- shared royalty-free catalog (Jamendo cache, populated by the server-side
-- sync in studio-v2.functions.ts) with no user data, and it serves a LIVE
-- feature: the Studio v2 music picker (searchMusic / listMusicTracks). Reads
-- are therefore intentionally public — stated explicitly here instead of
-- hidden behind a tautology.
--
-- Writes stay service-role only (no INSERT/UPDATE/DELETE policies for
-- anon/authenticated). The RESTRICTIVE "No guest sessions" policy from
-- 20260925112402 still excludes anonymous sessions from every table.
--
-- Non-destructive: drop + recreate policies only.

DROP POLICY IF EXISTS "Signed-in users read music tracks" ON public.music_tracks;
DROP POLICY IF EXISTS "music_tracks_read_all" ON public.music_tracks;

CREATE POLICY "music_tracks public catalog read" ON public.music_tracks
  FOR SELECT TO anon, authenticated USING (true);

COMMENT ON POLICY "music_tracks public catalog read" ON public.music_tracks IS
  'Intentionally public: shared royalty-free music catalog, no user data. Decision D25 in docs/DECISIONS.md.';
