import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Copy, KeyRound, Plus, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import { API_KEY_SCOPES } from "@/lib/api-keys/keys";
import type { ApiKeyMeta } from "@/lib/api-keys/keys.server";
import {
  createApiKeyFn,
  listApiKeysFn,
  revokeApiKeyFn,
  rotateApiKeyFn,
} from "@/lib/api-keys/api-keys.functions";
import { canEditWorkspace, type WorkspaceRole } from "@/lib/agency/agency";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  "read:projects": "List and read projects",
  "write:projects": "Create draft scripts",
  "read:analytics": "Read channels, analytics, learnings",
  "publish:request": "Create DRAFT publish jobs only — can never publish",
  "admin:keys": "Manage API keys via the REST API",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export function ApiKeyManager({ workspaceId, role }: { workspaceId: string; role: WorkspaceRole }) {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listApiKeysFn);
  const createFn = useServerFn(createApiKeyFn);
  const revokeFn = useServerFn(revokeApiKeyFn);
  const rotateFn = useServerFn(rotateApiKeyFn);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["read:projects"]);
  const [expiresAt, setExpiresAt] = useState("");
  /** The raw key — held in memory ONLY, shown once, cleared on dismiss. */
  const [freshRawKey, setFreshRawKey] = useState<{ name: string; rawKey: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const canEdit = canEditWorkspace(role);
  const key = ["settings-api-keys", workspaceId];
  const keys = useQuery({
    queryKey: key,
    queryFn: () => listFn({ data: { workspaceId } }),
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: key });

  const create = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          workspaceId,
          name: name.trim(),
          scopes,
          ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
        },
      }),
    onSuccess: (res) => {
      setFreshRawKey({ name: res.key.name, rawKey: res.rawKey });
      setCreateOpen(false);
      setName("");
      setScopes(["read:projects"]);
      setExpiresAt("");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not create API key"),
  });

  const revoke = useMutation({
    mutationFn: (keyId: string) => revokeFn({ data: { workspaceId, keyId } }),
    onSuccess: () => {
      toast.success("API key revoked");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not revoke API key"),
  });

  const rotate = useMutation({
    mutationFn: (keyId: string) => rotateFn({ data: { workspaceId, keyId } }),
    onSuccess: (res) => {
      setFreshRawKey({ name: res.key.name, rawKey: res.rawKey });
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not rotate API key"),
  });

  const copyRaw = async () => {
    if (!freshRawKey) return;
    try {
      await navigator.clipboard.writeText(freshRawKey.rawKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copy failed — select the key text manually.");
    }
  };

  const rows = (keys.data?.keys ?? []) as ApiKeyMeta[];

  return (
    <div className="space-y-4">
      {/* Raw key — shown ONCE. Dismissing clears it from memory. */}
      {freshRawKey && (
        <Card className="border-amber-500/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TriangleAlert className="size-4 text-amber-500" />
              Copy your key now — it will never be shown again
            </CardTitle>
            <CardDescription>
              Key “{freshRawKey.name}”. Store it somewhere safe (a secrets manager, not chat or
              email). After you dismiss this, only the key's metadata remains visible.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded-lg border border-border bg-muted px-3 py-2 font-mono text-sm">
                {freshRawKey.rawKey}
              </code>
              <Button variant="outline" onClick={copyRaw}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <Button variant="secondary" onClick={() => setFreshRawKey(null)}>
              I've stored it safely — dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">API keys</CardTitle>
            <CardDescription>
              Keys authenticate the public API and the MCP server (
              <code className="font-mono">Authorization: Bearer vdsk_…</code>). Only key metadata is
              stored — raw keys are shown once at creation.
            </CardDescription>
          </div>
          {canEdit && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> New key
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {keys.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading keys…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No API keys yet. Create one to let an agent or integration use the MCP server.
            </p>
          ) : (
            <div className="space-y-2">
              {rows.map((k) => (
                <div
                  key={k.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3"
                >
                  <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-40 flex-1">
                    <p className="text-sm font-medium">
                      {k.name}
                      {k.revokedAt && (
                        <Badge variant="destructive" className="ml-2">
                          revoked
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Created {formatDate(k.createdAt)}
                      {k.expiresAt ? ` · expires ${formatDate(k.expiresAt)}` : " · never expires"} ·
                      last used {formatDate(k.lastUsedAt)} · {k.rateLimitPerMin}/min
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {k.scopes.map((s) => (
                        <Badge key={s} variant="secondary" className="font-mono text-[10px]">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  {canEdit && !k.revokedAt && (
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Rotate “${k.name}”? The old key stops working immediately. The new key's raw value will be shown once, right after rotation.`,
                            )
                          ) {
                            rotate.mutate(k.id);
                          }
                        }}
                        disabled={rotate.isPending}
                      >
                        <RefreshCw className="size-3.5" /> Rotate
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (window.confirm(`Revoke “${k.name}”? This cannot be undone.`)) {
                            revoke.mutate(k.id);
                          }
                        }}
                        disabled={revoke.isPending}
                      >
                        <Trash2 className="size-3.5" /> Revoke
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {!canEdit && (
            <p className="mt-3 text-xs text-muted-foreground">
              Only owners and editors can create, rotate, or revoke keys.
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              The raw key is shown <strong>once</strong> after creation. Choose the minimum scopes
              the integration needs.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="key-name">Name</Label>
              <Input
                id="key-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. claude-mcp"
                maxLength={80}
              />
            </div>
            <div className="space-y-2">
              <Label>Scopes</Label>
              {API_KEY_SCOPES.map((s) => (
                <label key={s} className="flex cursor-pointer items-start gap-2 text-sm">
                  <Checkbox
                    checked={scopes.includes(s)}
                    onCheckedChange={(v) =>
                      setScopes((prev) => (v ? [...prev, s] : prev.filter((x) => x !== s)))
                    }
                  />
                  <span>
                    <code className="font-mono text-xs">{s}</code>
                    <span className="block text-xs text-muted-foreground">
                      {SCOPE_DESCRIPTIONS[s]}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="key-expiry">Expires (optional)</Label>
              <Input
                id="key-expiry"
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => create.mutate()}
              disabled={create.isPending || name.trim().length === 0 || scopes.length === 0}
            >
              {create.isPending ? "Creating…" : "Create key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
