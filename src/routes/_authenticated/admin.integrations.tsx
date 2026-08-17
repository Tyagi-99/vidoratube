import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { adminListIntegrations, adminSaveIntegration } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/integrations")({
  component: AdminIntegrationsPage,
});

type Draft = {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  settings: Record<string, string>;
};

function AdminIntegrationsPage() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(adminListIntegrations);
  const saveFn = useServerFn(adminSaveIntegration);

  const integrations = useQuery({
    queryKey: ["admin", "integrations"],
    queryFn: () => listFn({}),
  });
  const [drafts, setDrafts] = useState<Draft[]>([]);

  useEffect(() => {
    if (!integrations.data) return;
    setDrafts(
      integrations.data.map((row) => ({
        id: row.id,
        label: row.label,
        description: row.description ?? "",
        enabled: row.enabled,
        settings: (row.settings ?? {}) as Record<string, string>,
      })),
    );
  }, [integrations.data]);

  const save = useMutation({
    mutationFn: (draft: Draft) => saveFn({ data: draft }),
    onSuccess: () => {
      toast.success("Integration saved");
      queryClient.invalidateQueries({ queryKey: ["admin", "integrations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = (id: string, patch: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  if (integrations.isLoading) return <Skeleton className="h-96 w-full rounded-2xl" />;

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Integrations</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Turn services on or off. API keys are stored encrypted in your backend secrets — never here.
      </p>

      <div className="mt-6 grid gap-4">
        {drafts.map((draft) => {
          const meta = integrations.data?.find((i) => i.id === draft.id);
          return (
            <div key={draft.id} className="surface-card p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-foreground">{draft.label}</h2>
                    <Badge variant="secondary" className="capitalize">
                      {meta?.category}
                    </Badge>
                    <Badge variant={meta?.secret_present ? "default" : "secondary"}>
                      {meta?.secret_present ? "Key present" : "No key"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{draft.description}</p>
                  {meta?.secret_name && (
                    <p className="mt-2 font-mono text-xs text-muted-foreground">
                      Secret: {meta.secret_name}
                    </p>
                  )}
                </div>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  Enabled
                  <Switch
                    checked={draft.enabled}
                    onCheckedChange={(v) => update(draft.id, { enabled: v })}
                  />
                </label>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Display name</Label>
                  <Input
                    value={draft.label}
                    maxLength={80}
                    onChange={(e) => update(draft.id, { label: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Input
                    value={draft.description}
                    maxLength={300}
                    onChange={(e) => update(draft.id, { description: e.target.value })}
                  />
                </div>
              </div>

              <Button className="mt-5" onClick={() => save.mutate(draft)} disabled={save.isPending}>
                Save
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
