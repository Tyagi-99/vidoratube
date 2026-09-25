import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { decideApproval, listApprovals } from "@/lib/agency/agency.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function ApprovalQueue({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listApprovals);
  const decideFn = useServerFn(decideApproval);
  const [deciding, setDeciding] = useState<{ id: string; decision: "approved" | "rejected" } | null>(null);
  const [note, setNote] = useState("");

  const key = ["agency-approvals", workspaceId];
  const list = useQuery({ queryKey: key, queryFn: () => listFn({ data: { workspaceId } }) });

  const decide = useMutation({
    mutationFn: () =>
      decideFn({
        data: {
          approvalId: deciding!.id,
          decision: deciding!.decision,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      }),
    onSuccess: () => {
      toast.success(deciding!.decision === "approved" ? "Approved" : "Rejected");
      setDeciding(null);
      setNote("");
      queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not record decision"),
  });

  const statusBadge = (status: string) =>
    status === "approved" ? (
      <Badge className="bg-emerald-600">approved</Badge>
    ) : status === "rejected" ? (
      <Badge variant="destructive">rejected</Badge>
    ) : (
      <Badge variant="secondary">pending</Badge>
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Client approvals</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          The client reviews each scheduled draft here. An approval is sign-off only — the publish
          pipeline's own human gate still runs before anything goes live.
        </p>
        {list.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        <ul className="divide-y divide-border">
          {list.data?.approvals.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {statusBadge(a.status)}
                  {a.publishGateApproved && <Badge variant="outline">publish gate approved</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  Requested {new Date(a.created_at).toLocaleString()}
                  {a.decided_at ? ` · decided ${new Date(a.decided_at).toLocaleString()}` : ""}
                  {a.note ? ` · “${a.note}”` : ""}
                </p>
              </div>
              {a.status === "pending" && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDeciding({ id: a.id, decision: "rejected" })}
                  >
                    <X className="mr-1 size-3.5" /> Reject
                  </Button>
                  <Button size="sm" onClick={() => setDeciding({ id: a.id, decision: "approved" })}>
                    <Check className="mr-1 size-3.5" /> Approve
                  </Button>
                </div>
              )}
            </li>
          ))}
          {list.data?.approvals.length === 0 && (
            <li className="py-4 text-sm text-muted-foreground">No approvals requested yet.</li>
          )}
        </ul>

        <Dialog open={deciding !== null} onOpenChange={(o) => !o && setDeciding(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {deciding?.decision === "approved" ? "Approve this video" : "Reject this video"}
              </DialogTitle>
            </DialogHeader>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note for the agency (optional)"
              maxLength={500}
            />
            <DialogFooter>
              <Button onClick={() => decide.mutate()} disabled={decide.isPending}>
                {decide.isPending ? "Saving…" : "Confirm"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
