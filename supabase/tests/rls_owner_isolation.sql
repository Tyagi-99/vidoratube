-- Owner-isolation assertions for the five owner-scoped tables.
--
-- HOW TO RUN (against a staging/dev database, never production):
--   1. Create two throwaway auth users and note their UUIDs as USER_A / USER_B.
--   2. psql "$DATABASE_URL" -v user_a='<uuid-a>' -v user_b='<uuid-b>' -f rls_owner_isolation.sql
--
-- Each block sets the RLS role to one user and attempts cross-user access.
-- Any unexpected row returned (or unexpected success) raises an exception and
-- aborts the script. A clean run prints only NOTICE lines.

\set ON_ERROR_STOP on

DO $$
DECLARE
  v_user_a uuid := :'user_a'::uuid;
  v_user_b uuid := :'user_b'::uuid;
  v_count int;
BEGIN
  -- Seed one row per user in each owner-scoped table. Adjust the column lists
  -- if the schema changed; the RLS check is what matters, not the payload.
  PERFORM set_config('role', 'service_role', true);

  INSERT INTO public.profiles (id) VALUES (v_user_a), (v_user_b)
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.video_jobs (user_id, script, status)
    VALUES (v_user_a, 'rls-test script', 'queued'), (v_user_b, 'rls-test script', 'queued');
  INSERT INTO public.youtube_connections (user_id, channel_id, refresh_token)
    VALUES (v_user_a, 'UC-RLS-A', 'enc:dummy'), (v_user_b, 'UC-RLS-B', 'enc:dummy')
    ON CONFLICT (user_id) DO UPDATE SET channel_id = EXCLUDED.channel_id;
  INSERT INTO public.credit_ledger (user_id, delta, reason)
    VALUES (v_user_a, 10, 'rls-test'), (v_user_b, 10, 'rls-test');
  INSERT INTO public.content_items (user_id, canonical_url)
    VALUES (v_user_a, 'https://example.test/rls-a'), (v_user_b, 'https://example.test/rls-b');

  -- Now act as USER_A with RLS enforced (authenticated role, jwt claim set).
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_a::text)::text, true);

  SELECT count(*) INTO v_count FROM public.profiles WHERE id = v_user_b;
  IF v_count <> 0 THEN RAISE EXCEPTION 'profiles: user A read user B row'; END IF;

  SELECT count(*) INTO v_count FROM public.video_jobs WHERE user_id = v_user_b;
  IF v_count <> 0 THEN RAISE EXCEPTION 'video_jobs: user A read user B row'; END IF;

  SELECT count(*) INTO v_count FROM public.youtube_connections WHERE user_id = v_user_b;
  IF v_count <> 0 THEN RAISE EXCEPTION 'youtube_connections: user A read user B row'; END IF;

  SELECT count(*) INTO v_count FROM public.credit_ledger WHERE user_id = v_user_b;
  IF v_count <> 0 THEN RAISE EXCEPTION 'credit_ledger: user A read user B row'; END IF;

  SELECT count(*) INTO v_count FROM public.content_items WHERE user_id = v_user_b;
  IF v_count <> 0 THEN RAISE EXCEPTION 'content_items: user A read user B row'; END IF;

  -- Cross-user writes must also fail (RLS violation -> 0 rows affected).
  UPDATE public.video_jobs SET status = 'failed' WHERE user_id = v_user_b;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'video_jobs: user A updated user B row'; END IF;

  DELETE FROM public.credit_ledger WHERE user_id = v_user_b;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'credit_ledger: user A deleted user B row'; END IF;

  RAISE NOTICE 'RLS owner isolation: all checks passed';
END $$;

-- Clean up the seed rows.
DELETE FROM public.content_items WHERE canonical_url LIKE 'https://example.test/rls-%';
DELETE FROM public.credit_ledger WHERE reason = 'rls-test';
DELETE FROM public.youtube_connections WHERE channel_id IN ('UC-RLS-A', 'UC-RLS-B');
DELETE FROM public.video_jobs WHERE script = 'rls-test script';
-- profiles rows are left for the tester to remove with the throwaway users.
