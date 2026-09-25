import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceList } from "@/components/vidora/agency/WorkspaceList";

export const Route = createFileRoute("/_authenticated/agency/")({
  component: AgencyIndex,
});

function AgencyIndex() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <WorkspaceList />
    </div>
  );
}
