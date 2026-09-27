import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { listWorkspaces } from "@/lib/agency/agency.functions";
import { ApiKeyManager } from "@/components/vidora/api-keys/ApiKeyManager";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Phase 4 Stream E (F41) — /settings/api-keys.
 *
 * Session-authenticated API key management: create (raw key shown ONCE),
 * list metadata, rotate, revoke. Workspace members may view; only owners
 * and editors may create/rotate/revoke (enforced server-side).
 */
export const Route = createFileRoute("/_authenticated/settings/api-keys")({
  head: () => ({ meta: [{ title: "API keys — Vidora" }] }),
  component: ApiKeysPage,
});

function ApiKeysPage() {
  const listWs = useServerFn(listWorkspaces);
  const workspaces = useQuery({
    queryKey: ["settings-api-keys", "workspaces"],
    queryFn: () => listWs(),
  });
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  const rows = workspaces.data?.workspaces ?? [];
  const active = rows.find((w) => w.id === workspaceId) ?? rows[0] ?? null;
  const activeId = active?.id ?? null;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage keys for the public API and the MCP server, per workspace.
        </p>
      </div>

      {workspaces.isLoading ? (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <Loader2 className="size-4 animate-spin" />
            <CardDescription>Loading workspaces…</CardDescription>
          </CardHeader>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No workspaces</CardTitle>
            <CardDescription>
              Create a workspace on the Agency page before managing API keys.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="ws-select">Workspace</Label>
            <Select value={activeId ?? ""} onValueChange={setWorkspaceId}>
              <SelectTrigger id="ws-select" className="max-w-sm">
                <SelectValue placeholder="Choose a workspace" />
              </SelectTrigger>
              <SelectContent>
                {rows.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name} <span className="text-muted-foreground">· {w.role}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {active && activeId && (
            <ApiKeyManager key={activeId} workspaceId={activeId} role={active.role} />
          )}
        </>
      )}
    </div>
  );
}
