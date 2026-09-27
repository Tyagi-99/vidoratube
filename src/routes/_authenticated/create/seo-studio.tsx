import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, Loader2, Sparkles, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  exportSeoPackage,
  generateSeoPackage,
  listProjects,
} from "@/lib/creation/seo/seo.functions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/create/seo-studio")({
  component: SeoStudio,
});

type SeoPackageView = {
  id: string;
  project_id: string;
  chosen_title: string | null;
  titles: { title: string; score: { total: number } }[];
  description: string;
  hashtags: string[];
  thumbnail_concepts: {
    name: string;
    composition: string;
    overlayText: string;
    rationale: string;
  }[];
  keywords: string[];
  generated_at: string;
};

function SeoStudio() {
  const [projectId, setProjectId] = useState("");
  const [topic, setTopic] = useState("");
  const [title, setTitle] = useState("");
  const [keywords, setKeywords] = useState("");
  const [pkg, setPkg] = useState<SeoPackageView | null>(null);
  const [exportBlocked, setExportBlocked] = useState<string | null>(null);

  const projectsFn = useServerFn(listProjects);
  const generateFn = useServerFn(generateSeoPackage);
  const exportFn = useServerFn(exportSeoPackage);

  const projectsQuery = useQuery({ queryKey: ["seo-projects"], queryFn: () => projectsFn() });

  const generateMutation = useMutation({
    mutationFn: () =>
      generateFn({
        data: {
          projectId,
          topic: topic.trim(),
          title: title.trim() || undefined,
          keywords: keywords
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: (res) => {
      const p = res.package as unknown as SeoPackageView;
      setPkg(p);
      setExportBlocked(null);
      toast.success("SEO package generated.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not generate the package."),
  });

  const exportMutation = useMutation({
    mutationFn: () => exportFn({ data: { packageId: pkg!.id } }),
    onSuccess: (res) => {
      const r = res as unknown as { blocked?: boolean; reason?: string };
      if (r.blocked) {
        setExportBlocked(r.reason ?? "Blocked by project strict gate.");
        toast.warning("Export blocked by the project strict gate.");
      } else {
        setExportBlocked(null);
        toast.success("Package exported — safe to publish.");
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not export the package."),
  });

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success(`${label} copied.`),
      () => toast.error("Copy failed."),
    );
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">SEO & Metadata Studio</h1>
        <p className="text-sm text-muted-foreground">
          Ranked title options, description, hashtags, and 3 thumbnail concepts — all deterministic,
          scored with the same engine as Title Lab. Nothing here predicts click-through rate;
          thumbnails are concepts, not generated images. Export is blocked until the project's
          strict gate (F12) passes.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Generate a package</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                {(projectsQuery.data?.projects ?? []).map((p: { id: string; name: string }) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="seo-topic">Topic</Label>
            <Input
              id="seo-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Why do airplane windows have a tiny hole?"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="seo-title">Working title (optional)</Label>
            <Input
              id="seo-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Leave blank to derive from the topic"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="seo-kw">Keywords (comma-separated, optional)</Label>
            <Input
              id="seo-kw"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="airplane, window, science"
            />
          </div>
          <Button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending || !projectId || !topic.trim()}
          >
            {generateMutation.isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 size-4" />
            )}
            Generate package
          </Button>
        </CardContent>
      </Card>

      {generateMutation.isPending && <Skeleton className="h-64 w-full" />}

      {pkg && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Title options</span>
                <Badge variant="outline">scored by Title Lab engine</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {pkg.titles.map((t, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-3 rounded-md border p-3"
                >
                  <div>
                    <p className="font-medium">
                      {t.title} {i === 0 && <Badge className="ml-2">Recommended</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">Score: {t.score.total}/100</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => copy(t.title, "Title")}>
                    <Copy className="mr-1 size-3" /> Copy
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Description</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea value={pkg.description} readOnly rows={8} />
              <Button
                size="sm"
                variant="outline"
                onClick={() => copy(pkg.description, "Description")}
              >
                <Copy className="mr-1 size-3" /> Copy description
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Hashtags</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {pkg.hashtags.map((h) => (
                  <Badge key={h} variant="secondary">
                    {h}
                  </Badge>
                ))}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => copy(pkg.hashtags.join(" "), "Hashtags")}
              >
                <Copy className="mr-1 size-3" /> Copy all
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Type className="size-4" /> Thumbnail concepts
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              {pkg.thumbnail_concepts.map((c) => (
                <div key={c.name} className="rounded-md border p-3">
                  <p className="font-medium">{c.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{c.composition}</p>
                  <p className="mt-2 text-sm">
                    Overlay text: <span className="font-semibold">“{c.overlayText}”</span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{c.rationale}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Export</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Export runs the project's strict gate. If the gate blocks, you'll see exactly why —
                no package is marked publish-ready without passing.
              </p>
              {exportBlocked && (
                <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  Blocked: {exportBlocked}
                </p>
              )}
              <Button onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending}>
                {exportMutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                Check strict gate & export
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
