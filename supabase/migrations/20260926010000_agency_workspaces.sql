-- Sprint 7-8 (workstream E: agency tier) — agency workspaces.
--
-- Adds:
--   workspaces            A team/client container: name, owner, plan tier.
--   workspace_members     Membership with role: owner | editor | viewer.
--                         Clients sit in the workspace as `viewer`.
--   client_channels       Publishing destinations per workspace
--                         (platform + handle; test channels flagged).
--   brand_kits            One brand kit per workspace: logo path, colors,
--                         font. Passed into render job meta at enqueue.
--   workspace_approvals   Client-side approval before publish: a workspace
--                         member (typically the viewer/client) approves or
--                         rejects a publish job. INTEGRATION POINT (D62):
--                         this is the CLIENT sign-off stage, distinct from
--                         the sibling safety workstream's server-enforced
--                         `approvals` table (written only inside
--                         approvePublishJob; required by executePublishJob).
--                         After client approval here, the agency runs the
--                         normal approvePublishJob human gate, which writes
--                         the server-enforced record.
--   publish_jobs          Two nullable columns only:
--                         workspace_id, client_channel_id.
--   storage bucket brand-logos (private; uploads/downloads go through the
--                         service-role client in agency server functions, so
--                         no storage.objects policies grant client access —
--                         default-deny is the secure shape here).
--
-- Non-destructive: new tables, two new NULL columns, one new bucket, new
-- policies/RPCs only. No existing tables, rows, functions, or policies are
-- touched.
--
-- RLS: every table below is membership-scoped — a user sees ONLY workspaces
-- they belong to (via workspace_members). Viewers read; only owner/editor
-- roles write brand/channel data; approval decisions are recorded with the
-- decider's own id (no one can approve as someone else).

-- ── workspaces ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 'free' exports carry the Vidora watermark; paid tiers export clean.
  plan_tier text NOT NULL DEFAULT 'free'
    CHECK (plan_tier IN ('free', 'creator', 'studio')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── workspace_members ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS workspace_members_user_idx
  ON public.workspace_members (user_id);

-- ── client_channels ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  platform text NOT NULL
    CHECK (platform IN ('youtube', 'facebook', 'instagram', 'x', 'tiktok', 'linkedin')),
  handle text NOT NULL CHECK (char_length(handle) BETWEEN 1 AND 120),
  -- Test channels are used to verify publishing without touching real audiences.
  is_test_channel boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, platform, handle)
);
CREATE INDEX IF NOT EXISTS client_channels_workspace_idx
  ON public.client_channels (workspace_id);

-- ── brand_kits ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.brand_kits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- Storage path inside the brand-logos bucket (nullable: colors-only kit).
  logo_path text,
  primary_color text NOT NULL DEFAULT '#F59E0B'
    CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color text NOT NULL DEFAULT '#111827'
    CHECK (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  font_family text NOT NULL DEFAULT 'Inter'
    CHECK (char_length(font_family) BETWEEN 1 AND 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── workspace_approvals ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workspace_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  publish_job_id uuid NOT NULL UNIQUE REFERENCES public.publish_jobs(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_approvals_decision_consistent CHECK (
    (status = 'pending' AND decided_by IS NULL AND decided_at IS NULL)
    OR (status <> 'pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS workspace_approvals_workspace_idx
  ON public.workspace_approvals (workspace_id);

-- ── publish_jobs: workspace scoping (nullable columns only) ─────────────
ALTER TABLE public.publish_jobs
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.publish_jobs
  ADD COLUMN IF NOT EXISTS client_channel_id uuid REFERENCES public.client_channels(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS publish_jobs_workspace_idx
  ON public.publish_jobs (workspace_id) WHERE workspace_id IS NOT NULL;

-- ── storage bucket for brand logos (private) ─────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('brand-logos', 'brand-logos', false)
ON CONFLICT (id) DO UPDATE SET public = false;


-- RLS: membership checks go through SECURITY DEFINER helpers below.
-- Policies that join workspace_members inline recurse into
-- workspace_members' own policies (Postgres aborts with "infinite recursion
-- detected in policy"). The helpers run as the table owner, see membership
-- rows directly, and return booleans about the CALLER only, so they are safe
-- to expose to authenticated users. The static audit in
-- src/lib/rls-policies.test.ts recognizes these helpers and additionally
-- asserts each helper body references auth.uid() and workspace_members.
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_kits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_approvals ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_workspace_member(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members m
    WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_owner(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id = auth.uid() AND m.role = 'owner'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_editor(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id = auth.uid() AND m.role IN ('owner', 'editor')
  );
$$;

-- The workspace creator (workspaces.owner_id) bootstrapping their owner
-- membership row: a SECURITY DEFINER check because the creator has no
-- membership row yet, so the normal member policies cannot see the workspace.
CREATE OR REPLACE FUNCTION public.is_workspace_creator(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.id = p_workspace_id AND w.owner_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_workspace_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_workspace_owner(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_workspace_editor(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_workspace_creator(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_workspace_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_workspace_editor(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_workspace_creator(uuid) TO authenticated;

-- workspaces: members read; the creator inserts; owners update/delete.
DROP POLICY IF EXISTS "Members read their workspaces" ON public.workspaces;
CREATE POLICY "Members read their workspaces"
ON public.workspaces FOR SELECT TO authenticated
USING (public.is_workspace_member(workspaces.id));

DROP POLICY IF EXISTS "Users create workspaces they own" ON public.workspaces;
CREATE POLICY "Users create workspaces they own"
ON public.workspaces FOR INSERT TO authenticated
WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Owners update their workspaces" ON public.workspaces;
CREATE POLICY "Owners update their workspaces"
ON public.workspaces FOR UPDATE TO authenticated
USING (public.is_workspace_owner(workspaces.id))
WITH CHECK (public.is_workspace_owner(workspaces.id));

DROP POLICY IF EXISTS "Owners delete their workspaces" ON public.workspaces;
CREATE POLICY "Owners delete their workspaces"
ON public.workspaces FOR DELETE TO authenticated
USING (public.is_workspace_owner(workspaces.id));

-- workspace_members: members read the roster; owners manage it; the
-- workspace creator bootstraps their own owner row.
DROP POLICY IF EXISTS "Members read their workspace roster" ON public.workspace_members;
CREATE POLICY "Members read their workspace roster"
ON public.workspace_members FOR SELECT TO authenticated
USING (public.is_workspace_member(workspace_members.workspace_id));

DROP POLICY IF EXISTS "Owners manage membership" ON public.workspace_members;
CREATE POLICY "Owners manage membership"
ON public.workspace_members FOR ALL TO authenticated
USING (public.is_workspace_owner(workspace_members.workspace_id))
WITH CHECK (public.is_workspace_owner(workspace_members.workspace_id));

DROP POLICY IF EXISTS "Workspace creator bootstraps owner membership" ON public.workspace_members;
CREATE POLICY "Workspace creator bootstraps owner membership"
ON public.workspace_members FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND role = 'owner'
  AND public.is_workspace_creator(workspace_id)
);

-- client_channels: members read; owners and editors manage.
DROP POLICY IF EXISTS "Members read workspace channels" ON public.client_channels;
CREATE POLICY "Members read workspace channels"
ON public.client_channels FOR SELECT TO authenticated
USING (public.is_workspace_member(client_channels.workspace_id));

DROP POLICY IF EXISTS "Owners and editors manage channels" ON public.client_channels;
CREATE POLICY "Owners and editors manage channels"
ON public.client_channels FOR ALL TO authenticated
USING (public.is_workspace_editor(client_channels.workspace_id))
WITH CHECK (public.is_workspace_editor(client_channels.workspace_id));

-- brand_kits: members read; owners and editors manage.
DROP POLICY IF EXISTS "Members read workspace brand kit" ON public.brand_kits;
CREATE POLICY "Members read workspace brand kit"
ON public.brand_kits FOR SELECT TO authenticated
USING (public.is_workspace_member(brand_kits.workspace_id));

DROP POLICY IF EXISTS "Owners and editors manage brand kit" ON public.brand_kits;
CREATE POLICY "Owners and editors manage brand kit"
ON public.brand_kits FOR ALL TO authenticated
USING (public.is_workspace_editor(brand_kits.workspace_id))
WITH CHECK (public.is_workspace_editor(brand_kits.workspace_id));

-- workspace_approvals: members read; owners/editors request; any member
-- records their OWN decision (decided_by must be the caller).
DROP POLICY IF EXISTS "Members read workspace approvals" ON public.workspace_approvals;
CREATE POLICY "Members read workspace approvals"
ON public.workspace_approvals FOR SELECT TO authenticated
USING (public.is_workspace_member(workspace_approvals.workspace_id));

DROP POLICY IF EXISTS "Owners and editors request approvals" ON public.workspace_approvals;
CREATE POLICY "Owners and editors request approvals"
ON public.workspace_approvals FOR INSERT TO authenticated
WITH CHECK (
  public.is_workspace_editor(workspace_approvals.workspace_id)
  AND requested_by = auth.uid()
  AND status = 'pending'
);

DROP POLICY IF EXISTS "Members record their own approval decision" ON public.workspace_approvals;
CREATE POLICY "Members record their own approval decision"
ON public.workspace_approvals FOR UPDATE TO authenticated
USING (
  public.is_workspace_member(workspace_approvals.workspace_id)
  AND status = 'pending'
)
WITH CHECK (
  public.is_workspace_member(workspace_approvals.workspace_id)
  AND status IN ('approved', 'rejected')
  AND decided_by = auth.uid()
  AND decided_at IS NOT NULL
);
