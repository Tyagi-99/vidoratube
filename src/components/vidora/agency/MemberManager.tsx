import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Trash2, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { addMember, removeMember, updateMemberRole } from "@/lib/agency/agency.functions";
import { InviteManager } from "./InviteManager";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { WorkspaceRole } from "@/lib/agency/agency";

export function MemberManager({
  workspaceId,
  myRole,
  myUserId,
}: {
  workspaceId: string;
  myRole: WorkspaceRole;
  myUserId: string;
}) {
  const queryClient = useQueryClient();
  const addFn = useServerFn(addMember);
  const roleFn = useServerFn(updateMemberRole);
  const removeFn = useServerFn(removeMember);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("viewer");

  const isOwner = myRole === "owner";
  const roster = useMemberRoster(workspaceId);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["agency-members", workspaceId] });
    queryClient.invalidateQueries({ queryKey: ["agency-workspace", workspaceId] });
  };

  const add = useMutation({
    mutationFn: () => addFn({ data: { workspaceId, email: email.trim(), role } }),
    onSuccess: () => {
      toast.success("Member added");
      setEmail("");
      roster.refresh();
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not add member"),
  });

  const changeRole = useMutation({
    mutationFn: (args: { memberUserId: string; newRole: WorkspaceRole }) =>
      roleFn({ data: { workspaceId, memberUserId: args.memberUserId, role: args.newRole } }),
    onSuccess: () => {
      toast.success("Role updated");
      roster.refresh();
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update role"),
  });

  const remove = useMutation({
    mutationFn: (memberUserId: string) => removeFn({ data: { workspaceId, memberUserId } }),
    onSuccess: () => {
      toast.success("Member removed");
      roster.refresh();
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not remove member"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Members</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isOwner && (
          <div className="flex flex-wrap items-end gap-2">
            <Input
              className="min-w-48 flex-1"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="client@example.com"
              maxLength={200}
            />
            <Select value={role} onValueChange={(v) => setRole(v as WorkspaceRole)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="viewer">viewer</SelectItem>
                <SelectItem value="editor">editor</SelectItem>
                <SelectItem value="owner">owner</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={() => add.mutate()}
              disabled={add.isPending || email.trim().length === 0}
            >
              <UserPlus className="mr-1 size-4" /> Invite
            </Button>
          </div>
        )}
        {roster.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <ul className="divide-y divide-border">
            {roster.members.map((m) => (
              <li key={m.user_id} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-mono text-xs text-muted-foreground">
                    {m.user_id.slice(0, 8)}…
                  </span>
                  {m.user_id === myUserId && <Badge variant="secondary">you</Badge>}
                </div>
                <div className="flex items-center gap-2">
                  {isOwner && m.user_id !== myUserId ? (
                    <Select
                      value={m.role}
                      onValueChange={(v) =>
                        changeRole.mutate({ memberUserId: m.user_id, newRole: v as WorkspaceRole })
                      }
                    >
                      <SelectTrigger className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="viewer">viewer</SelectItem>
                        <SelectItem value="editor">editor</SelectItem>
                        <SelectItem value="owner">owner</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="outline">{m.role}</Badge>
                  )}
                  {isOwner && m.user_id !== myUserId && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => remove.mutate(m.user_id)}
                      aria-label="Remove member"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
            {roster.members.length === 0 && (
              <li className="py-4 text-sm text-muted-foreground">No members found.</li>
            )}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Viewers are the client side: they approve content but cannot edit channels, brand, or
          schedules.
        </p>
        {/* Phase 4 Stream E (F40): token-based invites for people without accounts. */}
        <InviteManager workspaceId={workspaceId} myRole={myRole} />
      </CardContent>
    </Card>
  );
}

// Roster read: members of the workspace can see the roster (RLS allows it),
// fetched with the caller's own client so no service-role round-trip is needed.
function useMemberRoster(workspaceId: string) {
  const [members, setMembers] = useState<{ user_id: string; role: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("workspace_members")
        .select("user_id, role")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: true });
      if (!cancelled) {
        setMembers((data ?? []) as { user_id: string; role: string }[]);
        setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, tick]);
  return { members, isLoading, refresh: () => setTick((t) => t + 1) };
}
