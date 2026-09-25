-- Sprint 3-4: chapter/segment rendering behavioral assertions
-- (render_chapters lifecycle, stale chapter requeue, RLS owner isolation,
-- tts_cache service-role-only access).
--
-- HOW TO RUN (against a staging/dev database, never production):
--   1. Create two throwaway auth users and note their UUIDs as USER_A / USER_B.
--   2. psql "$DATABASE_URL" -v user_a=<uuid> -v user_b=<uuid> -f supabase/tests/chapters.sql
--
-- A clean run prints only NOTICE lines and raises on any failure.
\set ON_ERROR_STOP on

\pset tuples_only off
\set ON_ERROR_STOP on

DO $$
DECLARE
  v_user_a uuid := :'user_a'::uuid;
  v_user_b uuid := :'user_b'::uuid;
  v_count int;
  v_render_a uuid;
  v_render_b uuid;
  v_requeued int;
BEGIN
  PERFORM set_config('role', 'service_role', true);

  -- ── Seed: one chapter-mode render per user, 6 chapters on user A's ──────
  INSERT INTO public.renders (user_id, engine, status, stage, meta)
  VALUES
    (v_user_a, 'server_ffmpeg', 'queued', 'queued',
     '{"chapterMode": true, "test_tag": "chapters-test"}'::jsonb),
    (v_user_b, 'server_ffmpeg', 'queued', 'queued',
     '{"chapterMode": true, "test_tag": "chapters-test"}'::jsonb);
  -- Fetch both ids explicitly.
  SELECT id INTO v_render_a FROM public.renders
   WHERE user_id = v_user_a AND meta ->> 'test_tag' = 'chapters-test'
   ORDER BY created_at DESC LIMIT 1;
  SELECT id INTO v_render_b FROM public.renders
   WHERE user_id = v_user_b AND meta ->> 'test_tag' = 'chapters-test'
   ORDER BY created_at DESC LIMIT 1;

  INSERT INTO public.render_chapters (render_id, chapter_index, title, script_text, status)
  SELECT v_render_a, g, 'Chapter ' || g, 'script ' || g, 'queued'
  FROM generate_series(1, 6) g;
  INSERT INTO public.render_chapters (render_id, chapter_index, title, script_text, status)
  VALUES (v_render_b, 1, 'Other user chapter', 'other', 'queued');

  -- ── Test 1: stale 'rendering' chapters requeue; exhausted budget fails ──
  UPDATE public.render_chapters
     SET status = 'rendering', attempts = 1,
         claimed_at = now() - make_interval(secs => 600),
         claimed_by = 'dead-worker'
   WHERE render_id = v_render_a AND chapter_index IN (4, 5);
  UPDATE public.render_chapters
     SET status = 'rendering', attempts = 3, max_attempts = 3,
         claimed_at = now() - make_interval(secs => 600),
         claimed_by = 'dead-worker'
   WHERE render_id = v_render_a AND chapter_index = 6;

  v_requeued := public.requeue_stale_chapters(300);
  IF v_requeued <> 2 THEN
    RAISE EXCEPTION 'requeue: expected 2 requeued chapters, got %', v_requeued;
  END IF;

  SELECT count(*) INTO v_count FROM public.render_chapters
   WHERE render_id = v_render_a AND chapter_index IN (4, 5)
     AND status = 'queued' AND attempts = 2
     AND claimed_at IS NULL AND claimed_by IS NULL;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'requeue: chapters 4-5 not back to queued with bumped attempts';
  END IF;

  SELECT count(*) INTO v_count FROM public.render_chapters
   WHERE render_id = v_render_a AND chapter_index = 6
     AND status = 'failed' AND error = 'Worker died; retries exhausted';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'requeue: chapter 6 (budget exhausted) not terminal-failed';
  END IF;

  -- A second call requeues nothing (idempotent).
  v_requeued := public.requeue_stale_chapters(300);
  IF v_requeued <> 0 THEN
    RAISE EXCEPTION 'requeue: second call should requeue 0, got %', v_requeued;
  END IF;

  -- ── Test 2: RLS owner isolation on render_chapters ──────────────────────
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_a::text)::text, true);

  SELECT count(*) INTO v_count FROM public.render_chapters
   WHERE render_id = v_render_b;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'rls: user A read user B chapters';
  END IF;

  SELECT count(*) INTO v_count FROM public.render_chapters
   WHERE render_id = v_render_a;
  IF v_count <> 6 THEN
    RAISE EXCEPTION 'rls: user A should read own 6 chapters, got %', v_count;
  END IF;

  UPDATE public.render_chapters SET status = 'failed' WHERE render_id = v_render_b;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'rls: user A updated user B chapters';
  END IF;

  -- ── Test 3: tts_cache is service-role only ─────────────────────────────
  PERFORM set_config('role', 'service_role', true);
  INSERT INTO public.tts_cache (provider, voice_id, language_code, paragraph_hash, audio_path)
  VALUES ('elevenlabs', 'voice-1', 'en', 'hash-rls-test', 'tts-cache/x.mp3')
  ON CONFLICT (provider, voice_id, language_code, paragraph_hash) DO NOTHING;

  PERFORM set_config('role', 'authenticated', true);
  SELECT count(*) INTO v_count FROM public.tts_cache WHERE paragraph_hash = 'hash-rls-test';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'rls: authenticated role read tts_cache';
  END IF;

  RAISE NOTICE 'chapters: all checks passed';
END $$;

-- Clean up the seed rows (service role; cascades to chapters).
DELETE FROM public.tts_cache WHERE paragraph_hash = 'hash-rls-test';
DELETE FROM public.renders WHERE meta ->> 'test_tag' = 'chapters-test';
