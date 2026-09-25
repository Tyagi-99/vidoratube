import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { createWorkspace, listWorkspaces } from "@/lib/agency/agency.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function WorkspaceList() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listWorkspaces);
  const createFn = useServerFn(createWorkspace);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const list = useQuery({ queryKey: ["agency-workspaces"], queryFn: () => listFn() });

  const create = useMutation({
    mutationFn: (workspaceName: string) => createFn({ data: { name: workspaceName } }),
    onSuccess: () => {
      toast.success("Workspace created");
      setOpen(false);
      setName("");
      queryClient.invalidateQueries({ queryKey: ["agency-workspaces"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not create workspace"),
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold">Agency workspaces</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One workspace per client team: channels, brand kit, scheduling, and client approvals.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 size-4" /> New workspace
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New workspace</DialogTitle>
            </DialogHeader>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Co — social"
              maxLength={80}
            />
            <DialogFooter>
              <Button
                onClick={() => create.mutate(name.trim())}
                disabled={create.isPending || name.trim().length === 0}
              >
                {create.isPending ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {list.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {list.data?.workspaces.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No workspaces yet. Create one to start managing a client's channels, brand, and approvals.
          </CardContent>
        </Card>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.data?.workspaces.map((w) => (
          <Link key={w.id} to="/agency/$workspaceId" params={{ workspaceId: w.id }}>
            <Card className="transition-colors hover:border-accent">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base">{w.name}</CardTitle>
                <Badge variant="secondary">{w.role}</Badge>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Plan: {w.plan_tier === "free" ? "Free (Vidora watermark on exports)" : `${w.plan_tier} (white-label exports)`}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
