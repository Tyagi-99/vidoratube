import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Copy, MailPlus, Trash2 } from "lucide-react";
import {
  createInviteFn,
  listInvitesFn,
  revokeInviteFn,
  type InviteMeta,
} from "@/lib/invites/invites.functions";
import { canEditWorkspace, type WorkspaceRole } from "@/lib/agency/agency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function inviteStatus(inv: InviteMeta): "pending" | "accepted" | "revoked" | "expired" {
  if (inv.revoked_at) return "revoked";
  if (inv.accepted_at) return "accepted";
  if (new Date(inv.expires_at).getTime() < Date.now()) return "expired";
  return "pending";
}

const STATUS_VARIANT: Record<string, "secondary" | "default" | "destructive" | "outline"> = {
  pending: "secondary",
  accepted: "default",
  revoked: "destructive",
  expired: "outline",
};

/**
 * Phase 4 Stream E (F40) — token-based workspace invites.
 * Rendered inside MemberManager: create invites, see pending invites,
 * revoke them. The raw invite link is shown ONCE after creation.
 */
export function InviteManager({
  workspaceId,
  myRole,
}: {
  workspaceId: string;
  myRole: WorkspaceRole;
}) {
  const queryClient = useQueryClient();
  const createFn = useServerFn(createInviteFn);
  const listFn = useServerFn(listInvitesFn);
  const revokeFn = useServerFn(revokeInviteFn);

  const canManage = canEditWorkspace(myRole);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("viewer");
  /** Shown once after creation — cleared on dismiss, never persisted. */
  const [fresh, setFresh] = useState<{
    email: string;
    role: WorkspaceRole;
    rawToken: string;
    emailed: boolean;
    emailError: string | null;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const key = ["workspace-invites", workspaceId];
  const invites = useQuery({ queryKey: key, queryFn: () => listFn({ data: { workspaceId } }) });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: key });

  const create = useMutation({
    mutationFn: () => createFn({ data: { workspaceId, email: email.trim(), role } }),
    onSuccess: (res) => {
      setFresh({
        email: res.invite.email,
        role: res.invite.role,
        rawToken: res.rawToken,
        emailed: res.emailed,
        emailError: res.emailError,
      });
      setEmail("");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not create invite"),
  });

  const revoke = useMutation({
    mutationFn: (inviteId: string) => revokeFn({ data: { workspaceId, inviteId } }),
    onSuccess: () => {
      toast.success("Invite revoked");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not revoke invite"),
  });

  const acceptUrl = fresh
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/invite/accept?token=${fresh.rawToken}`
    : "";

  const rows = (invites.data?.invites ?? []) as InviteMeta[];

  return (
    <div className="space-y-4 border-t border-border pt-4">
      <div>
        <h4 className="text-sm font-semibold">Invites</h4>
        <p className="text-xs text-muted-foreground">
          Invite people who don't have a Vidora account yet. They sign up, open the link, and accept
          — the invite is tied to their email address.
        </p>
      </div>

      {fresh && (
        <div className="space-y-2 rounded-xl border border-amber-500/50 p-3">
          <p className="text-sm font-medium">
            Invite created for {fresh.email} ({fresh.role})
          </p>
          {fresh.emailed ? (
            <p className="text-xs text-muted-foreground">
              An invite email was sent. The link below is a backup — it won't be shown again.
            </p>
          ) : (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {fresh.emailError
                ? `Email could not be sent (${fresh.emailError}). Share this link manually:`
                : "Email is not configured — share this link manually:"}
            </p>
          )}
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded-lg border border-border bg-muted px-3 py-2 font-mono text-xs">
              {acceptUrl}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(acceptUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  toast.error("Copy failed — select the link manually.");
                }
              }}
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setFresh(null)}>
            Done — dismiss
          </Button>
        </div>
      )}

      {canManage && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1 space-y-1">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@example.com"
              maxLength={200}
            />
          </div>
          <div className="space-y-1">
            <Label>Role</Label>
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
          </div>
          <Button
            onClick={() => create.mutate()}
            disabled={create.isPending || email.trim().length === 0}
          >
            <MailPlus className="mr-1 size-4" />
            {create.isPending ? "Sending…" : "Send invite"}
          </Button>
        </div>
      )}

      {invites.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading invites…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No invites yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((inv) => {
            const status = inviteStatus(inv);
            return (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="text-sm">
                  <span className="font-medium">{inv.email}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {inv.role} · expires {new Date(inv.expires_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={STATUS_VARIANT[status]}>{status}</Badge>
                  {canManage && status === "pending" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Revoke invite for ${inv.email}`}
                      onClick={() => {
                        if (window.confirm(`Revoke the invite for ${inv.email}?`)) {
                          revoke.mutate(inv.id);
                        }
                      }}
                      disabled={revoke.isPending}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
