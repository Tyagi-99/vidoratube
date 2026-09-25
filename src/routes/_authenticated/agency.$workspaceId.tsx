import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft } from "lucide-react";
import { getWorkspace } from "@/lib/agency/agency.functions";
import { canEditWorkspace, type WorkspaceRole } from "@/lib/agency/agency";
import { ChannelManager } from "@/components/vidora/agency/ChannelManager";
import { BrandKitEditor } from "@/components/vidora/agency/BrandKitEditor";
import { BulkScheduler } from "@/components/vidora/agency/BulkScheduler";
import { ApprovalQueue } from "@/components/vidora/agency/ApprovalQueue";
import { MemberManager } from "@/components/vidora/agency/MemberManager";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/agency/$workspaceId")({
  component: AgencyWorkspace,
});

function AgencyWorkspace() {
  const { workspaceId } = Route.useParams();
  const getFn = useServerFn(getWorkspace);
  const ws = useQuery({
    queryKey: ["agency-workspace", workspaceId],
    queryFn: () => getFn({ data: { workspaceId } }),
  });

  if (ws.isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <p className="text-sm text-muted-foreground">Loading workspace…</p>
      </div>
    );
  }
  if (ws.isError || !ws.data?.workspace) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <p className="text-sm text-destructive">Workspace not found, or you are not a member.</p>
        <Link to="/agency" className="mt-2 inline-block text-sm text-accent">
          Back to workspaces
        </Link>
      </div>
    );
  }

  const role = ws.data.role as WorkspaceRole;
  const canEdit = canEditWorkspace(role);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link to="/agency" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Workspaces
      </Link>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-semibold">
          {(ws.data.workspace as { name: string }).name}
        </h1>
        <Badge variant="secondary">{role}</Badge>
        <Badge variant="outline">
          {(ws.data.workspace as { plan_tier: string }).plan_tier === "free"
            ? "Free — exports carry the Vidora watermark"
            : "White-label exports"}
        </Badge>
      </div>

      <Tabs defaultValue="approvals" className="space-y-4">
        <TabsList>
          <TabsTrigger value="approvals">Approvals</TabsTrigger>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="channels">Channels</TabsTrigger>
          <TabsTrigger value="brand">Brand kit</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
        </TabsList>
        <TabsContent value="approvals">
          <ApprovalQueue workspaceId={workspaceId} />
        </TabsContent>
        <TabsContent value="schedule">
          {canEdit ? (
            <BulkScheduler workspaceId={workspaceId} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Only owners and editors can schedule. Your client role is approvals.
            </p>
          )}
        </TabsContent>
        <TabsContent value="channels">
          <ChannelManager workspaceId={workspaceId} canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="brand">
          <BrandKitEditor workspaceId={workspaceId} canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="members">
          <WorkspaceMembersTab workspaceId={workspaceId} role={role} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function WorkspaceMembersTab({ workspaceId, role }: { workspaceId: string; role: WorkspaceRole }) {
  // The caller's own user id for the "you" badge — read from the auth session.
  const { data: sessionUserId } = useQuery({
    queryKey: ["agency-me"],
    queryFn: async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? "";
    },
  });
  return <MemberManager workspaceId={workspaceId} myRole={role} myUserId={sessionUserId ?? ""} />;
}
