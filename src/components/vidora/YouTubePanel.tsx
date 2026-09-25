import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Youtube, Link2Off, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import {
  getYouTubeConnection,
  startYouTubeConnect,
  requestUploadScope,
  disconnectYouTube,
} from "@/lib/youtube.functions";
import { YT_REVOKED_FLAG } from "./PublishDialog";

export function YouTubePanel() {
  const queryClient = useQueryClient();
  const readFn = useServerFn(getYouTubeConnection);
  const startFn = useServerFn(startYouTubeConnect);
  const scopeFn = useServerFn(requestUploadScope);
  const disconnectFn = useServerFn(disconnectYouTube);

  const state = useQuery({ queryKey: ["youtube"], queryFn: () => readFn({}) });

  // Set when a publish failed because Google reported the grant revoked.
  // The server already deleted the dead row, so the panel shows "Reconnect"
  // (not plain "Connect") until the user connects again.
  const [wasRevoked, setWasRevoked] = useState(false);
  useEffect(() => {
    try {
      setWasRevoked(sessionStorage.getItem(YT_REVOKED_FLAG) === "1");
    } catch {
      setWasRevoked(false);
    }
  }, []);

  const clearRevokedFlag = () => {
    try {
      sessionStorage.removeItem(YT_REVOKED_FLAG);
    } catch {
      /* ignore */
    }
    setWasRevoked(false);
  };

  const connect = useMutation({
    mutationFn: () => startFn({}),
    onSuccess: ({ url }) => {
      clearRevokedFlag();
      window.location.href = url;
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const grantScope = useMutation({
    mutationFn: () => scopeFn({}),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const disconnect = useMutation({
    mutationFn: () => disconnectFn({}),
    onSuccess: () => {
      toast.success("YouTube disconnected");
      queryClient.invalidateQueries({ queryKey: ["youtube"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const connection = state.data?.connection;
  const needsUploadScope = Boolean(connection && !connection.hasUploadScope);

  return (
    <div className="surface-card p-5">
      {wasRevoked && !connection && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3">
          <ShieldAlert className="h-5 w-5 shrink-0 text-destructive" />
          <p className="flex-1 text-sm">
            <span className="font-semibold text-foreground">Your YouTube connection was revoked.</span>{" "}
            <span className="text-muted-foreground">
              This happens if you removed Vidora&apos;s access at Google. Reconnect to keep
              publishing.
            </span>
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <Youtube className="h-5 w-5" />
          </div>
          <div>
            <p className="font-semibold text-foreground">YouTube publishing</p>
            {state.isError ? (
              <p className="text-sm text-destructive">
                Couldn&apos;t check the connection (
                {state.error instanceof Error ? state.error.message : "unknown error"}).{" "}
                <button
                  type="button"
                  className="font-medium underline underline-offset-2"
                  onClick={() => state.refetch()}
                >
                  Retry
                </button>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {state.isLoading
                  ? "Checking connection…"
                  : !state.data?.configured
                    ? "Not configured yet — add your Google OAuth keys in Admin → Integrations."
                    : connection
                      ? needsUploadScope
                        ? `Connected to ${connection.channel_title ?? "your channel"} — upload permission not granted yet`
                        : `Connected to ${connection.channel_title ?? "your channel"} — ready to publish`
                      : wasRevoked
                        ? "Reconnect your channel to keep publishing finished videos."
                        : "Connect your channel to publish finished videos straight to YouTube."}
              </p>
            )}
          </div>
        </div>
        {state.data?.configured &&
          (connection ? (
            <div className="flex flex-wrap gap-2">
              {needsUploadScope && (
                <Button
                  className="gap-2"
                  onClick={() => grantScope.mutate()}
                  disabled={grantScope.isPending}
                >
                  {grantScope.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Youtube className="h-4 w-4" />
                  )}
                  Grant upload permission
                </Button>
              )}
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => disconnect.mutate()}
                disabled={disconnect.isPending}
              >
                <Link2Off className="h-4 w-4" />
                Disconnect
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-end gap-1">
              <Button
                className="gap-2"
                onClick={() => connect.mutate()}
                disabled={connect.isPending}
              >
                {connect.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Youtube className="h-4 w-4" />
                )}
                {wasRevoked ? "Reconnect YouTube" : "Connect YouTube"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Read-only access at first — upload permission is asked only when you publish.
              </p>
            </div>
          ))}
      </div>
    </div>
  );
}
