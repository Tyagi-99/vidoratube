-- Workspace-isolation assertions for the agency-tier tables.
--
-- HOW TO RUN (against a staging/dev database, never production):
--   1. Create two throwaway auth users and note their UUIDs as USER_A / USER_B.
--   2. psql "$DATABASE_URL" -v user_a=<uuid-a> -v user_b=<uuid-b> -f supabase/tests/rls_workspace_isolation.sql
--
-- Each block sets the RLS role to one user and attempts cross-workspace
-- access. Any unexpected row returned (or unexpected success) raises an
-- exception and aborts the script. A clean run prints only NOTICE lines.
--
-- The scratch-database variant (no auth schema) stubs auth.users/auth.uid;
-- see the workstream report for the exact harness.

\set ON_ERROR_STOP on

-- psql does not interpolate :'vars' inside dollar-quoted DO bodies, so the
-- caller-supplied UUIDs are staged through session GUCs first.
SELECT set_config('agency_test.user_a', :'user_a', false);
SELECT set_config('agency_test.user_b', :'user_b', false);

DO $$
DECLARE
  v_user_a uuid := current_setting('agency_test.user_a')::uuid;
  v_user_b uuid := current_setting('agency_test.user_b')::uuid;
  v_ws_a uuid;
  v_ws_b uuid;
  v_count int;
BEGIN
  PERFORM set_config('role', 'service_role', true);

  -- Self-cleaning: remove leftovers from any prior interrupted run first.
  DELETE FROM public.workspaces WHERE name LIKE 'rls-ws-%';

  -- Seed: two workspaces owned by different users, one member row each.
  INSERT INTO public.workspaces (name, owner_id)
    VALUES ('rls-ws-a', v_user_a), ('rls-ws-b', v_user_b);
  SELECT id INTO v_ws_a FROM public.workspaces WHERE owner_id = v_user_a AND name = 'rls-ws-a' ORDER BY created_at DESC LIMIT 1;
  SELECT id INTO v_ws_b FROM public.workspaces WHERE owner_id = v_user_b AND name = 'rls-ws-b' ORDER BY created_at DESC LIMIT 1;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (v_ws_a, v_user_a, 'owner'), (v_ws_b, v_user_b, 'owner')
    ON CONFLICT (workspace_id, user_id) DO NOTHING;

  INSERT INTO public.client_channels (workspace_id, platform, handle)
    VALUES (v_ws_a, 'youtube', '@rls-a'), (v_ws_b, 'youtube', '@rls-b')
    ON CONFLICT (workspace_id, platform, handle) DO NOTHING;

  INSERT INTO public.brand_kits (workspace_id, primary_color, secondary_color)
    VALUES (v_ws_a, '#FF0000', '#00FF00'), (v_ws_b, '#0000FF', '#FFFF00')
    ON CONFLICT (workspace_id) DO NOTHING;

  -- Act as USER_A with RLS enforced (authenticated role, jwt claim set).
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_a::text)::text, true);

  -- A cannot read B's workspace row.
  SELECT count(*) INTO v_count FROM public.workspaces WHERE id = v_ws_b;
  IF v_count <> 0 THEN RAISE EXCEPTION 'workspaces: user A read user B workspace'; END IF;

  -- A cannot read B's membership roster.
  SELECT count(*) INTO v_count FROM public.workspace_members WHERE workspace_id = v_ws_b;
  IF v_count <> 0 THEN RAISE EXCEPTION 'workspace_members: user A read user B roster'; END IF;

  -- A cannot read B's channels.
  SELECT count(*) INTO v_count FROM public.client_channels WHERE workspace_id = v_ws_b;
  IF v_count <> 0 THEN RAISE EXCEPTION 'client_channels: user A read user B channels'; END IF;

  -- A cannot read B's brand kit.
  SELECT count(*) INTO v_count FROM public.brand_kits WHERE workspace_id = v_ws_b;
  IF v_count <> 0 THEN RAISE EXCEPTION 'brand_kits: user A read user B brand kit'; END IF;

  -- A cannot read B's approvals.
  SELECT count(*) INTO v_count FROM public.workspace_approvals WHERE workspace_id = v_ws_b;
  IF v_count <> 0 THEN RAISE EXCEPTION 'workspace_approvals: user A read user B approvals'; END IF;

  -- A cannot modify B's workspace, channels, or brand kit.
  UPDATE public.workspaces SET name = 'pwned' WHERE id = v_ws_b;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'workspaces: user A updated user B workspace'; END IF;

  UPDATE public.client_channels SET handle = '@pwned' WHERE workspace_id = v_ws_b;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'client_channels: user A updated user B channel'; END IF;

  UPDATE public.brand_kits SET primary_color = '#000000' WHERE workspace_id = v_ws_b;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'brand_kits: user A updated user B brand kit'; END IF;

  -- A cannot add themselves to B's workspace. RLS raises instead of
  -- silently affecting zero rows, so expect the error.
  BEGIN
    INSERT INTO public.workspace_members (workspace_id, user_id, role)
      VALUES (v_ws_b, v_user_a, 'viewer');
    RAISE EXCEPTION 'workspace_members: user A joined user B workspace';
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
    -- insufficient_privilege = RLS blocked the insert (expected).
    -- raise_exception = our own guard above (unexpected success path).
    IF SQLSTATE = 'P0001' THEN RAISE; END IF;
  END;

  -- A CAN read and edit their own workspace (sanity: policies don't over-deny).
  SELECT count(*) INTO v_count FROM public.workspaces WHERE id = v_ws_a;
  IF v_count <> 1 THEN RAISE EXCEPTION 'workspaces: user A cannot read own workspace'; END IF;
  UPDATE public.workspaces SET name = 'rls-ws-a-renamed' WHERE id = v_ws_a;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN RAISE EXCEPTION 'workspaces: owner A cannot update own workspace'; END IF;

  RAISE NOTICE 'RLS workspace isolation: all checks passed';
END $$;

-- Clean up the seed rows (cascades clear members/channels/kits).
DELETE FROM public.workspaces WHERE name IN ('rls-ws-a', 'rls-ws-b', 'rls-ws-a-renamed');
