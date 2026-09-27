import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  BarChart3,
  Compass,
  FolderKanban,
  Layers,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { listFolders } from "@/lib/intelligence/folders.functions";

export const Route = createFileRoute("/_authenticated/intelligence/")({
  component: IntelligenceHub,
});

interface Section {
  title: string;
  to: string;
  description: string;
  icon: LucideIcon;
  /** Short status hint under the description. Null → computed below. */
  statusHint: string | null;
}

const SECTIONS: Section[] = [
  {
    title: "Niches",
    to: "/intelligence/niches",
    description: "Score and track content niches from real YouTube data.",
    icon: Compass,
    statusHint: "YouTube Data API",
  },
  {
    title: "Channels",
    to: "/intelligence/channels",
    description: "Tracked channels with subscriber growth and video history.",
    icon: Layers,
    statusHint: "YouTube Data API",
  },
  {
    title: "Outliers",
    to: "/intelligence/outliers",
    description: "Videos beating their channel median — scored per snapshot.",
    icon: Sparkles,
    statusHint: "YouTube Data API",
  },
  {
    title: "Video Intel",
    to: "/intelligence/channels",
    description:
      "Per-video packaging and performance analysis — open a channel to reach any video.",
    icon: BarChart3,
    statusHint: "YouTube Data API",
  },
  {
    title: "Trend Radar",
    to: "/intelligence/trends",
    description: "Velocity-ranked topics with cited evidence sources.",
    icon: TrendingUp,
    statusHint: "YouTube Data API",
  },
  {
    title: "Folders",
    to: "/intelligence/folders",
    description:
      "Smart folders: pin items or auto-collect with rules across videos, ideas, sources, and channels.",
    icon: FolderKanban,
    statusHint: null, // computed from listFolders below
  },
];

function IntelligenceHub() {
  const listFoldersFn = useServerFn(listFolders);
  const foldersQuery = useQuery({
    queryKey: ["intelligence-folders"],
    queryFn: () => listFoldersFn({ data: {} }),
  });

  const folderCount =
    foldersQuery.data?.status === "ok"
      ? foldersQuery.data.folders.length
      : null;

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="font-display text-2xl font-semibold text-foreground">
          Intelligence
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Research the market before you create: score niches, track channels,
          spot outliers, and organize everything into smart folders.
        </p>
      </div>

      {foldersQuery.isError && (
        <div
          role="alert"
          className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        >
          Could not load folder status. YouTube sections below are unaffected.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const hint =
            s.title === "Folders"
              ? foldersQuery.isLoading
                ? null
                : folderCount === null
                  ? "Unavailable"
                  : folderCount === 0
                    ? "No folders yet"
                    : `${folderCount} folder${folderCount === 1 ? "" : "s"}`
              : s.statusHint;
          return (
            <Link key={s.title} to={s.to as never} className="group">
              <Card className="h-full transition-colors group-hover:border-accent/60">
                <CardHeader className="flex flex-row items-center gap-3 space-y-0">
                  <span className="flex size-10 items-center justify-center rounded-lg border border-border bg-card">
                    <Icon className="size-5 text-accent" aria-hidden="true" />
                  </span>
                  <CardTitle className="text-base">{s.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{s.description}</p>
                  <div className="mt-4">
                    {hint === null ? (
                      <Skeleton className="h-5 w-24" />
                    ) : (
                      <Badge variant="secondary">{hint}</Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
