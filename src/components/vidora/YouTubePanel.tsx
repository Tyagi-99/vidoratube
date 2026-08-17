import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Youtube, Link2Off, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  getYouTubeConnection,
  startYouTubeConnect,
  disconnectYouTube,
} from "@/lib/youtube.functions";

export function YouTubePanel() {
  const queryClient = useQueryClient();
  const readFn = useServerFn(getYouTubeConnection);
  const startFn = useServerFn(startYouTubeConnect);
  const disconnectFn = useServerFn(disconnectYouTube);

  const state = useQuery({ queryKey: ["youtube"], queryFn: () => readFn({}) });

  const connect = useMutation({
    mutationFn: () => startFn({}),
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

  return (
    <div className="surface-card flex flex-wrap items-center justify-between gap-4 p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
          <Youtube className="h-5 w-5" />
        </div>
        <div>
          <p className="font-semibold text-foreground">YouTube publishing</p>
          <p className="text-sm text-muted-foreground">
            {state.isLoading
              ? "Checking connection…"
              : !state.data?.configured
                ? "Not configured yet — add your Google OAuth keys in Admin → Integrations."
                : connection
                  ? `Connected to ${connection.channel_title ?? "your channel"}`
                  : "Connect your channel to publish finished videos straight to YouTube."}
          </p>
        </div>
      </div>
      {state.data?.configured &&
        (connection ? (
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => disconnect.mutate()}
            disabled={disconnect.isPending}
          >
            <Link2Off className="h-4 w-4" />
            Disconnect
          </Button>
        ) : (
          <Button className="gap-2" onClick={() => connect.mutate()} disabled={connect.isPending}>
            {connect.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Youtube className="h-4 w-4" />
            )}
            Connect YouTube
          </Button>
        ))}
    </div>
  );
}
