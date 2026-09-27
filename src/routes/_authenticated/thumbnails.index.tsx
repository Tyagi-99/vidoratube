/**
 * F15 — standalone thumbnails route: layered canvas editor + AI variant
 * generation for a chosen project. Project-scoped variants still belong to
 * `public.thumbnails`; the layered design surface is `thumbnail_projects`.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ThumbnailStudio } from "@/components/vidora/ThumbnailStudio";
import { getProject, listProjects } from "@/lib/studio.functions";

export const Route = createFileRoute("/_authenticated/thumbnails/")({
  validateSearch: (search: Record<string, unknown>) => ({
    projectId: typeof search["projectId"] === "string" ? (search["projectId"] as string) : "",
  }),
  head: () => ({
    meta: [
      { title: "Thumbnails — Vidora AI" },
      {
        name: "description",
        content:
          "Design thumbnails on a layered canvas and generate AI variants for your projects.",
      },
    ],
  }),
  component: ThumbnailsPage,
});

function ThumbnailsPage() {
  const { projectId } = Route.useSearch();
  const listFn = useServerFn(listProjects);
  const getProjectFn = useServerFn(getProject);

  const projectsQuery = useQuery({
    queryKey: ["studio-projects"],
    queryFn: () => listFn({}),
  });
  const projectQuery = useQuery({
    queryKey: ["studio-project", projectId],
    queryFn: () => getProjectFn({ data: { id: projectId } }),
    enabled: !!projectId,
  });

  const projects: { id: string; title?: string }[] = Array.isArray(projectsQuery.data)
    ? (projectsQuery.data as { id: string; title?: string }[])
    : [];
  const project = (
    projectQuery.data as { project?: { id: string; title?: string; topic?: string } } | undefined
  )?.project;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">Thumbnails</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Design on a layered canvas, generate AI variants, compare, pick a winner, and link it to a
        packaging experiment.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Label>Project</Label>
        <Select
          value={projectId}
          onValueChange={(v) =>
            window.location.assign(`/thumbnails?projectId=${encodeURIComponent(v)}`)
          }
        >
          <SelectTrigger className="w-64">
            <SelectValue placeholder={projectsQuery.isLoading ? "Loading…" : "Pick a project"} />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.title ?? p.id.slice(0, 8)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {projectId && (
          <Button size="sm" variant="ghost" asChild>
            <Link to="/thumbnails" search={{ projectId: "" }}>
              Clear
            </Link>
          </Button>
        )}
      </div>

      <div className="mt-6">
        {!projectId ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Pick a project above to start designing thumbnails.
          </p>
        ) : projectQuery.isLoading ? (
          <Skeleton className="aspect-video w-full" />
        ) : projectQuery.isError || !project ? (
          <div className="rounded-lg border border-destructive/40 p-4 text-sm">
            Could not load the project.
            <Button
              size="sm"
              variant="outline"
              className="ml-3"
              onClick={() => projectQuery.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : (
          <ThumbnailStudio
            projectId={project.id}
            videoTitle={project.title ?? "Untitled"}
            videoTopic={project.topic ?? project.title ?? "Untitled"}
          />
        )}
      </div>
    </div>
  );
}
