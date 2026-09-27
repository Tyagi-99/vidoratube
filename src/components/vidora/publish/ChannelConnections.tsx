import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Facebook,
  Instagram,
  Link2Off,
  Loader2,
  Plug,
  ShieldAlert,
  XCircle,
  Youtube,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  disconnectYouTube,
  getYouTubeConnection,
  startYouTubeConnect,
} from "@/lib/youtube.functions";
import {
  disconnectMeta,
  getMetaConnection,
  startMetaConnect,
} from "@/lib/meta.functions";
import {
  getPublishQuotaSummary,
  listChannelConnections,
  removeChannelConnection,
  runChannelHealthCheck,
} from "@/lib/publish/channels.functions";

/**
 * Phase 4, Stream A (F27) — channel registry, health, and quota UI.
 *
 * - Connect/disconnect cards for YouTube + Meta (Facebook Page / Instagram).
 * - Registry rows (channel_connections) with connection status + live health
 *   badges, per-platform quota display, and removal.
 * - Honest unavailable states when OAuth credentials are not configured, when
 *   a token is expired/revoked, or when the founder-designated test-account
 *   gate is off. Nothing fake: every badge reflects real data.
 */

const STATUS_LABEL: Record<string, { label: string; tone: "default" | "secondary" | "destructive" | "outline" }> = {
  connected: { label: "Connected", tone: "default" },
  healthy: { label: "Healthy", tone: "default" },
  degraded: { label: "Degraded", tone: "secondary" },
  expired: { label: "Expired", tone: "destructive" },
  revoked: { label: "Revoked", tone: "destructive" },
};

function StatusBadge({ status }: { status: string | null }) {
  const entry = status ? STATUS_LABEL[status] : null;
  if (!entry) return <Badge variant="outline">Unknown</Badge>;
  return <Badge variant={entry.tone}>{entry.label}</Badge>;
}

function PlatformIcon({ platform }: { platform: string }) {
  if (platform === "youtube") return <Youtube className="h-4 w-4 text-red-500" />;
  if (platform === "instagram") return <Instagram className="h-4 w-4 text-pink-500" />;
  if (platform === "facebook") return <Facebook className="h-4 w-4 text-blue-500" />;
  return <Plug className="h-4 w-4" />;
}

export function ChannelConnections() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["yt-connection"] });
    queryClient.invalidateQueries({ queryKey: ["meta-connection"] });
    queryClient.invalidateQueries({ queryKey: ["channel-registry"] });
    queryClient.invalidateQueries({ queryKey: ["yt-quota"] });
  };

  const ytReadFn = useServerFn(getYouTubeConnection);
  const metaReadFn = useServerFn(getMetaConnection);
  const registryReadFn = useServerFn(listChannelConnections);
  const quotaReadFn = useServerFn(getPublishQuotaSummary);

  const ytState = useQuery({ queryKey: ["yt-connection"], queryFn: () => ytReadFn({}) });
  const metaState = useQuery({ queryKey: ["meta-connection"], queryFn: () => metaReadFn({}) });
  const registry = useQuery({ queryKey: ["channel-registry"], queryFn: () => registryReadFn({}) });
  const quota = useQuery({ queryKey: ["yt-quota"], queryFn: () => quotaReadFn({}) });

  const ytStartFn = useServerFn(startYouTubeConnect);
  const ytDisconnectFn = useServerFn(disconnectYouTube);
  const metaStartFn = useServerFn(startMetaConnect);
  const metaDisconnectFn = useServerFn(disconnectMeta);
  const healthFn = useServerFn(runChannelHealthCheck);
  const removeFn = useServerFn(removeChannelConnection);

  const connectYouTube = useMutation({
    mutationFn: () => ytStartFn({}),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const disconnectYouTubeM = useMutation({
    mutationFn: () => ytDisconnectFn({}),
    onSuccess: () => {
      toast.success("YouTube disconnected");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const connectMeta = useMutation({
    mutationFn: () => metaStartFn({}),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const disconnectMetaM = useMutation({
    mutationFn: () => metaDisconnectFn({}),
    onSuccess: () => {
      toast.success("Meta disconnected");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const healthCheck = useMutation({
    mutationFn: (connectionId: string) => healthFn({ data: { connection_id: connectionId } }),
    onSuccess: (result: { connection: { status: string } }) => {
      toast.success(`Health check: ${result.connection.status}`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const removeConnection = useMutation({
    mutationFn: (connectionId: string) => removeFn({ data: { connection_id: connectionId } }),
    onSuccess: () => {
      toast.success("Channel removed from registry");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const yt = ytState.data;
  const meta = metaState.data;
  const connections = registry.data?.connections ?? [];
  const testDesignations = registry.data?.testDesignations;
  const q = quota.data;

  return (
    <div className="space-y-6">
      {/* Connect cards */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Youtube className="h-5 w-5 text-red-500" /> YouTube
            </CardTitle>
            <CardDescription>
              OAuth with incremental upload scope. Publishing is limited to the founder-designated
              test channel.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {ytState.isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : !yt?.configured ? (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <span>
                  YouTube OAuth is not configured on this server (missing client credentials), so
                  connecting is unavailable. Ask the founder to configure it.
                </span>
              </div>
            ) : yt.connection ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{yt.connection.channel_title ?? "Connected channel"}</span>
                  <StatusBadge status={yt.connection.hasUploadScope ? "connected" : "degraded"} />
                </div>
                {!yt.connection.hasUploadScope && (
                  <p className="text-xs text-muted-foreground">
                    Read-only scope granted. The upload scope is requested at publish time.
                  </p>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => disconnectYouTubeM.mutate()}
                  disabled={disconnectYouTubeM.isPending}
                >
                  {disconnectYouTubeM.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Link2Off className="mr-2 h-4 w-4" />
                  )}
                  Disconnect
                </Button>
              </div>
            ) : (
              <Button onClick={() => connectYouTube.mutate()} disabled={connectYouTube.isPending}>
                {connectYouTube.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Connect YouTube
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Facebook className="h-5 w-5 text-blue-500" /> Meta — Page &amp; Instagram
            </CardTitle>
            <CardDescription>
              Facebook Login → long-lived Page token. Publishing is limited to the founder-designated
              test Page / IG account.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {metaState.isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : !meta?.configured ? (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <span>
                  Meta OAuth is not configured on this server (missing app credentials), so
                  connecting is unavailable. Ask the founder to configure it.
                </span>
              </div>
            ) : meta.connection ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{meta.connection.page_name ?? "Connected Page"}</span>
                  <StatusBadge status="connected" />
                </div>
                {meta.connection.ig_username && (
                  <p className="text-xs text-muted-foreground">Instagram: @{meta.connection.ig_username}</p>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => disconnectMetaM.mutate()}
                  disabled={disconnectMetaM.isPending}
                >
                  {disconnectMetaM.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Link2Off className="mr-2 h-4 w-4" />
                  )}
                  Disconnect
                </Button>
              </div>
            ) : (
              <Button onClick={() => connectMeta.mutate()} disabled={connectMeta.isPending}>
                {connectMeta.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Connect Meta
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Registry */}
      <Card>
        <CardHeader>
          <CardTitle>Channel registry</CardTitle>
          <CardDescription>
            Every connected channel, with live health and the founder-designated test accounts
            flagged. Only test accounts can publish.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {registry.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : registry.isError ? (
            <div className="flex items-start gap-2 text-sm text-destructive">
              <ShieldAlert className="h-4 w-4" /> Couldn't load the registry: {(registry.error as Error).message}
            </div>
          ) : connections.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No channels registered yet — connect YouTube or Meta above.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {connections.map((c) => {
                const isTest =
                  (c.platform === "youtube" &&
                    testDesignations?.youtubeChannelId &&
                    c.external_channel_id === testDesignations.youtubeChannelId) ||
                  (c.platform === "facebook" &&
                    testDesignations?.meta?.pageId &&
                    c.external_channel_id === testDesignations.meta.pageId) ||
                  (c.platform === "instagram" &&
                    testDesignations?.meta?.igUserId &&
                    c.external_channel_id === testDesignations.meta.igUserId);
                return (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 py-3">
                    <PlatformIcon platform={c.platform} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {c.display_name ?? c.external_channel_id}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {c.platform} · {c.external_channel_id}
                        {c.status === "revoked" && " — disconnected, audit trail kept"}
                      </p>
                    </div>
                    {isTest && <Badge variant="outline">Test account</Badge>}
                    <StatusBadge status={c.status} />
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => healthCheck.mutate(c.id)}
                        disabled={healthCheck.isPending || c.status === "revoked"}
                        title="Run a live health check against the platform"
                      >
                        {healthCheck.isPending ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <Activity className="mr-1 h-3 w-3" />
                        )}
                        Check health
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeConnection.mutate(c.id)}
                        disabled={removeConnection.isPending}
                        title="Remove from registry (does not revoke the OAuth grant — use Disconnect above)"
                      >
                        <XCircle className="mr-1 h-3 w-3" /> Remove
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {testDesignations &&
            !testDesignations.youtubeChannelId &&
            !testDesignations.meta.pageId && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <span>
                  Publishing is currently <strong>disabled</strong>: no founder-designated test
                  channel is configured on the server. Channels can be connected and health-checked,
                  but nothing can publish until the founder designates test accounts.
                </span>
              </div>
            )}
        </CardContent>
      </Card>

      {/* Quota */}
      <Card>
        <CardHeader>
          <CardTitle>YouTube quota — last 24 hours</CardTitle>
          <CardDescription>
            The hard platform ceilings: 100 videos.insert calls/day/project, 100 search.list
            calls/day, and 10,000 shared quota units/day. Window is rolling 24h (YouTube resets at midnight PT).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {quota.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : quota.isError ? (
            <p className="text-sm text-destructive">Couldn't load quota: {(quota.error as Error).message}</p>
          ) : q ? (
            <div className="grid gap-4 sm:grid-cols-3">
              {(
                [
                  { label: "videos.insert calls", used: q.videosInsertUsed, limit: q.videosInsertLimit },
                  { label: "search.list calls", used: q.searchListUsed, limit: q.searchListLimit },
                  { label: "Shared quota units", used: q.sharedPoolUnitsUsed, limit: q.sharedPoolUnitsLimit },
                ] as const
              ).map((b) => {
                const pct = b.limit > 0 ? Math.min(100, (b.used / b.limit) * 100) : 0;
                const exhausted = b.used >= b.limit;
                return (
                  <div key={b.label} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{b.label}</span>
                      {exhausted ? (
                        <CheckCircle2 className="h-4 w-4 text-destructive" />
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {b.used.toLocaleString()} / {b.limit.toLocaleString()}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${exhausted ? "bg-destructive" : "bg-primary"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    {exhausted && (
                      <p className="mt-1 text-xs text-destructive">
                        Limit reached — further calls fail until the daily reset.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
          <p className="mt-3 text-xs text-muted-foreground">
            Instagram publishing quota is checked live at publish time against the Graph API; Meta
            does not expose a daily remaining-quota endpoint.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
