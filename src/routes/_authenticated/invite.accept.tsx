import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { acceptInviteFn, getInvitePreviewFn } from "@/lib/invites/invites.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Phase 4 Stream E (F40) — /invite/accept?token=vdinv_…
 *
 * Explicit acceptance step: the signed-in user reviews which workspace and
 * role they're accepting, then clicks Accept. The server verifies the token
 * hash, expiry, revocation, and that the account email matches the invited
 * email before minting membership.
 */
export const Route = createFileRoute("/_authenticated/invite/accept")({
  validateSearch: (s: Record<string, unknown>) => ({
    token: typeof s["token"] === "string" ? s["token"] : "",
  }),
  head: () => ({ meta: [{ title: "Accept workspace invite — Vidora" }] }),
  component: InviteAcceptPage,
});

function InviteAcceptPage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const previewFn = useServerFn(getInvitePreviewFn);
  const acceptFn = useServerFn(acceptInviteFn);
  const [done, setDone] = useState(false);

  const preview = useQuery({
    queryKey: ["invite-preview", token],
    queryFn: () => previewFn({ data: { token } }),
    enabled: token.length > 0,
    retry: false,
  });

  const accept = useMutation({
    mutationFn: () => acceptFn({ data: { token } }),
    onSuccess: (res: { workspaceId: string }) => {
      setDone(true);
      toast.success("Welcome to the workspace!");
      setTimeout(() => {
        navigate({ to: "/agency/$workspaceId", params: { workspaceId: res.workspaceId } });
      }, 1500);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not accept the invite"),
  });

  // Keep the preview fresh in case the tab sits open past expiry.
  useEffect(() => {
    if (!token) return;
    const t = setInterval(() => preview.refetch(), 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="mx-auto w-full max-w-lg p-4 md:p-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Workspace invite</CardTitle>
          <CardDescription>
            Review the invite below, then accept to join the workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!token ? (
            <p className="text-sm text-muted-foreground">
              This link is missing its invite token. Ask the sender for a fresh invite link.
            </p>
          ) : preview.isLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Checking the invite…
            </p>
          ) : preview.isError ? (
            <div className="space-y-2">
              <p className="flex items-start gap-2 text-sm">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                <span>
                  {preview.error instanceof Error
                    ? preview.error.message
                    : "This invite link doesn't work."}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                Invites expire after 7 days and stop working once revoked or accepted. Ask the
                workspace owner for a new invite.
              </p>
            </div>
          ) : done ? (
            <p className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="size-4 text-green-500" />
              Invite accepted — taking you to the workspace…
            </p>
          ) : (
            <>
              <div className="rounded-xl border border-border p-4">
                <p className="text-sm">
                  You've been invited to join <strong>{preview.data?.workspaceName}</strong>
                </p>
                <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                  Role: <Badge variant="secondary">{preview.data?.role}</Badge>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Invite sent to {preview.data?.email}. You're signed in — if that email doesn't
                  match your account, switch accounts before accepting.
                </p>
              </div>
              <Button
                onClick={() => accept.mutate()}
                disabled={accept.isPending}
                className="w-full"
              >
                {accept.isPending ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" /> Accepting…
                  </>
                ) : (
                  "Accept invite"
                )}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
