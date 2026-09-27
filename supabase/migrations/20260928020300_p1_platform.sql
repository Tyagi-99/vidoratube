-- Phase 1 (Foundation) — Platform domain.
--
-- PINNED CONTRACTS (implemented exactly — other workers code against these):
--   audit_logs, workspace_budgets, project_budgets, api_keys.
-- All four were verified MISSING from supabase/migrations (36 files,
-- latest 20260926050000). No near-duplicates exist (billing_events is raw
-- webhook payload storage — a different domain from the workspace audit log).
--
-- Forward-only, non-destructive: CREATE TABLE IF NOT EXISTS only.

-- ── audit_logs (PINNED CONTRACT) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_workspace_idx
  ON public.audit_logs (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx
  ON public.audit_logs (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx
  ON public.audit_logs (entity_type, entity_id);

COMMENT ON TABLE public.audit_logs IS
  'Phase 1 (PINNED, F40/F41): append-only workspace audit trail. Written ONLY by the server (service role); members may read. actor_user_id is nullable so system/service-role actions are representable.';

-- ── workspace_budgets (PINNED CONTRACT) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workspace_budgets (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  monthly_credit_cap numeric,
  alert_threshold_pct integer NOT NULL DEFAULT 80,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.workspace_budgets IS
  'Phase 1 (PINNED): monthly credit cap + alert threshold per workspace. NULL monthly_credit_cap = no cap.';

-- ── project_budgets (PINNED CONTRACT) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_budgets (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  credit_cap numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.project_budgets IS
  'Phase 1 (PINNED): credit cap per project. NULL credit_cap = no cap.';

-- ── api_keys (PINNED CONTRACT) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  -- key_hash: SHA-256 (or stronger) of the key. The RAW key is shown ONCE at
  -- creation and NEVER stored — a leaked database cannot mint API access.
  key_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL DEFAULT '{}',
  rate_limit_per_min integer NOT NULL DEFAULT 60 CHECK (rate_limit_per_min > 0),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_keys_workspace_idx
  ON public.api_keys (workspace_id, created_at DESC);

COMMENT ON TABLE public.api_keys IS
  'Phase 1 (PINNED, F41): scoped API keys for the public API / MCP server. Stores the key HASH only — never the raw key. Rotation = insert new row + revoke old (revoked_at).';
COMMENT ON COLUMN public.api_keys.key_hash IS
  'Hash of the API key (never the raw key). Verified with a constant-time compare in server code.';

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- audit_logs: members read; NO client write policies — rows are written only
-- by the server (service role), mirroring the approvals pattern (D61).
DROP POLICY IF EXISTS "Members read workspace audit logs" ON public.audit_logs;
CREATE POLICY "Members read workspace audit logs"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (public.is_workspace_member(audit_logs.workspace_id));

-- workspace_budgets: members read; owners manage the cap.
DROP POLICY IF EXISTS "Members read workspace budget" ON public.workspace_budgets;
CREATE POLICY "Members read workspace budget"
  ON public.workspace_budgets FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_budgets.workspace_id));
DROP POLICY IF EXISTS "Owners manage workspace budget" ON public.workspace_budgets;
CREATE POLICY "Owners manage workspace budget"
  ON public.workspace_budgets FOR ALL TO authenticated
  USING (public.is_workspace_owner(workspace_budgets.workspace_id))
  WITH CHECK (public.is_workspace_owner(workspace_budgets.workspace_id));

-- project_budgets: scoped to the owning user via the parent project.
DROP POLICY IF EXISTS project_budgets_owner ON public.project_budgets;
CREATE POLICY project_budgets_owner ON public.project_budgets
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.projects p
            WHERE p.id = project_budgets.project_id AND p.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.projects p
            WHERE p.id = project_budgets.project_id AND p.user_id = auth.uid())
  );

-- api_keys: members read (the hash is not reversible); owners/editors create
-- and revoke. Follows the client_channels pattern.
DROP POLICY IF EXISTS "Members read workspace api keys" ON public.api_keys;
CREATE POLICY "Members read workspace api keys"
  ON public.api_keys FOR SELECT TO authenticated
  USING (public.is_workspace_member(api_keys.workspace_id));
DROP POLICY IF EXISTS "Owners and editors manage api keys" ON public.api_keys;
CREATE POLICY "Owners and editors manage api keys"
  ON public.api_keys FOR ALL TO authenticated
  USING (public.is_workspace_editor(api_keys.workspace_id))
  WITH CHECK (public.is_workspace_editor(api_keys.workspace_id));

-- RESTRICTIVE "No guest sessions" on every new table (mirrors the pattern
-- from migration 20260925112402; new tables carry their own copy).
DO $$
DECLARE
  t text;
  tbls text[] := ARRAY[
    'audit_logs', 'workspace_budgets', 'project_budgets', 'api_keys'
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
DROP TRIGGER IF EXISTS workspace_budgets_touch_updated_at ON public.workspace_budgets;
CREATE TRIGGER workspace_budgets_touch_updated_at BEFORE UPDATE ON public.workspace_budgets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS project_budgets_touch_updated_at ON public.project_budgets;
CREATE TRIGGER project_budgets_touch_updated_at BEFORE UPDATE ON public.project_budgets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
