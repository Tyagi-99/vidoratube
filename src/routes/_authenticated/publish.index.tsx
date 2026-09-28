import { createFileRoute } from "@tanstack/react-router";
import { ChannelConnections } from "@/components/vidora/publish/ChannelConnections";

export const Route = createFileRoute("/_authenticated/publish/")({
  component: PublishIndex,
});

function PublishIndex() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Publish</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect channels, monitor health and quota, then review, schedule, and publish.
        </p>
      </div>
      <ChannelConnections />
    </div>
  );
}
