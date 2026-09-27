/**
 * F15 — thumbnail project editor: layered canvas + AI variant generation +
 * compare/select-winner + Phase-4 experiment linkage.
 *
 * Honesty rules: paid generation is preflight-gated; without an image-provider
 * key the generate action shows the unconfigured state and never a fake image.
 * Variant RENDERS are read from / written to `public.thumbnails` (the
 * canonical variant store); `thumbnail_projects` is the design surface.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Check, FlaskConical, Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { LayeredCanvasEditor } from "./LayeredCanvasEditor";
import {
  generateThumbnailVariantsFn,
  getOrCreateThumbnailProject,
  linkVariantToExperimentFn,
  listThumbnailVariants,
  saveThumbnailCanvas,
  selectThumbnailWinner,
  setThumbnailProjectStatusFn,
  thumbnailProviderStatus,
} from "@/lib/creation/thumbnails/thumbnails.functions";
import { type CanvasAspect, type CanvasState } from "@/lib/creation/thumbnails/canvas";
import type { VariantView } from "@/lib/creation/thumbnails/projects.server";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
};

export function ThumbnailProjectEditor({
  projectId,
  videoTitle,
  videoTopic,
}: {
  projectId: string;
  videoTitle: string;
  videoTopic: string;
}) {
  const queryClient = useQueryClient();
  const getOrCreateFn = useServerFn(getOrCreateThumbnailProject);
  const saveCanvasFn = useServerFn(saveThumbnailCanvas);
  const setStatusFn = useServerFn(setThumbnailProjectStatusFn);
  const genVariantsFn = useServerFn(generateThumbnailVariantsFn);
  const listVariantsFn = useServerFn(listThumbnailVariants);
  const selectWinnerFn = useServerFn(selectThumbnailWinner);
  const linkArmFn = useServerFn(linkVariantToExperimentFn);
  const providerStatusFn = useServerFn(thumbnailProviderStatus);

  const [aspect, setAspect] = useState<CanvasAspect>("16:9");
  const [canvas, setCanvas] = useState<CanvasState | null>(null);
  const [dirty, setDirty] = useState(false);
  const [variantCount, setVariantCount] = useState(4);
  const [genError, setGenError] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [experimentId, setExperimentId] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

  const projectQuery = useQuery({
    queryKey: ["thumbnail-project", projectId],
    queryFn: () => getOrCreateFn({ data: { project_id: projectId, aspect } }),
  });
  const loaded = projectQuery.data?.ok ? projectQuery.data.data : null;

  useEffect(() => {
    if (loaded && !dirty) setCanvas(loaded.canvas);
  }, [loaded, dirty]);

  const variantsQuery = useQuery({
    queryKey: ["thumbnail-variants", projectId],
    queryFn: () => listVariantsFn({ data: { project_id: projectId } }),
  });
  const providerQuery = useQuery({
    queryKey: ["thumbnail-provider-status"],
    queryFn: () => providerStatusFn({ data: {} }),
    staleTime: 60_000,
  });

  const saveCanvas = useMutation({
    mutationFn: (next: CanvasState) =>
      saveCanvasFn({ data: { thumbnail_project_id: loaded!.project.id, canvas: next } }),
    onSuccess: () => {
      setDirty(false);
      toast.success("Canvas saved");
      queryClient.invalidateQueries({ queryKey: ["thumbnail-project", projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setStatus = useMutation({
    mutationFn: (status: "draft" | "in_review" | "approved") =>
      setStatusFn({ data: { thumbnail_project_id: loaded!.project.id, status } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`Status: ${STATUS_LABEL[res.data.status]}`);
      queryClient.invalidateQueries({ queryKey: ["thumbnail-project", projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const generate = useMutation({
    mutationFn: () => {
      setGenError(null);
      return genVariantsFn({
        data: {
          project_id: projectId,
          video_title: videoTitle,
          video_topic: videoTopic,
          count: variantCount,
          aspect,
        },
      });
    },
    onSuccess: (res) => {
      if (!res.ok) {
        // Expected business outcomes (unconfigured / denied preflight) render
        // honestly in the panel — they are not thrown.
        setGenError(res.message);
        return;
      }
      toast.success(`${res.data.length} variants generated`);
      queryClient.invalidateQueries({ queryKey: ["thumbnail-variants", projectId] });
    },
    onError: (e: Error) => setGenError(e.message),
  });

  const selectWinner = useMutation({
    mutationFn: (thumbnailId: string) => selectWinnerFn({ data: { thumbnail_id: thumbnailId } }),
    onSuccess: () => {
      toast.success("Winner selected");
      queryClient.invalidateQueries({ queryKey: ["thumbnail-variants", projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const linkArm = useMutation({
    mutationFn: (thumbnailId: string) => {
      setLinkError(null);
      return linkArmFn({
        data: {
          experiment_id: experimentId.trim(),
          thumbnail_id: thumbnailId,
          arm_type: "variant",
        },
      });
    },
    onSuccess: (res) => {
      if (!res.ok) {
        setLinkError(res.message);
        return;
      }
      toast.success("Linked to experiment");
      setExperimentId("");
    },
    onError: (e: Error) => setLinkError(e.message),
  });

  const variants: VariantView[] = variantsQuery.data?.ok
    ? (variantsQuery.data.data as VariantView[])
    : [];
  const visible = variants.filter((v) => v.aspect === aspect);
  const compared = visible.filter((v) => compareIds.includes(v.id));
  const providerConfigured = providerQuery.data?.configured ?? null;

  const toggleCompare = (id: string) =>
    setCompareIds((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length >= 2
          ? [prev[1]!, id]
          : [...prev, id],
    );

  if (projectQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="aspect-video w-full" />
      </div>
    );
  }
  if (projectQuery.isError || !loaded) {
    return (
      <div className="rounded-lg border border-destructive/40 p-4 text-sm">
        Could not load the thumbnail project:{" "}
        {projectQuery.error instanceof Error ? projectQuery.error.message : "unknown error"}
        <Button size="sm" variant="outline" className="ml-3" onClick={() => projectQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header: aspect + status flow */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <span className="rounded-full border px-2.5 py-0.5 text-xs font-medium">
            {STATUS_LABEL[loaded.project.status] ?? loaded.project.status}
          </span>
          {loaded.problems.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-amber-600">
              <AlertTriangle className="h-3.5 w-3.5" />
              Canvas had {loaded.problems.length} problem{loaded.problems.length === 1 ? "" : "s"} —
              reset to empty
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Select value={aspect} onValueChange={(v) => setAspect(v as CanvasAspect)}>
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="16:9">16:9</SelectItem>
              <SelectItem value="9:16">9:16</SelectItem>
            </SelectContent>
          </Select>
          {loaded.project.status === "draft" && (
            <Button
              size="sm"
              variant="outline"
              disabled={setStatus.isPending}
              onClick={() => setStatus.mutate("in_review")}
            >
              Submit for review
            </Button>
          )}
          {loaded.project.status === "in_review" && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={setStatus.isPending}
                onClick={() => setStatus.mutate("draft")}
              >
                Back to draft
              </Button>
              <Button
                size="sm"
                disabled={setStatus.isPending}
                onClick={() => setStatus.mutate("approved")}
              >
                <Check className="mr-1 h-3.5 w-3.5" /> Approve
              </Button>
            </>
          )}
          {loaded.project.status === "approved" && (
            <span className="text-xs text-muted-foreground">Approved — final.</span>
          )}
        </div>
      </div>

      {/* Layered canvas */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">Layered canvas</h4>
          <Button
            size="sm"
            disabled={!canvas || !dirty || saveCanvas.isPending}
            onClick={() => canvas && saveCanvas.mutate(canvas)}
          >
            {saveCanvas.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {dirty ? "Save canvas" : "Saved"}
          </Button>
        </div>
        {canvas ? (
          <LayeredCanvasEditor
            canvas={canvas}
            aspect={aspect}
            onChange={(next) => {
              setCanvas(next);
              setDirty(true);
            }}
          />
        ) : (
          <Skeleton className="aspect-video w-full" />
        )}
      </div>

      {/* AI variant generation */}
      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">AI variants</h4>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Count</Label>
            <Select value={String(variantCount)} onValueChange={(v) => setVariantCount(Number(v))}>
              <SelectTrigger className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 6, 8].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={() => generate.mutate()}
              disabled={generate.isPending || providerConfigured === false}
              title={
                providerConfigured === false ? "Image generation is not configured" : undefined
              }
            >
              {generate.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="mr-1 h-4 w-4" />
              )}
              {generate.isPending ? "Generating…" : `Generate ${variantCount} variants`}
            </Button>
          </div>
        </div>

        {providerConfigured === false && (
          <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              Image generation is <strong>not configured</strong> (no image-provider key). Variant
              generation is disabled — Vidora will not fabricate thumbnails. You can still design
              with the layered canvas above.
            </span>
          </p>
        )}
        {genError && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            {genError}
          </p>
        )}

        {variantsQuery.isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="aspect-video w-full" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No variants yet for {aspect}. Generate AI variants above, or design on the canvas.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {visible.map((v) => (
              <div
                key={v.id}
                className={`relative overflow-hidden rounded-lg border-2 ${
                  v.selected
                    ? "border-primary"
                    : compareIds.includes(v.id)
                      ? "border-amber-500"
                      : "border-transparent"
                }`}
              >
                {v.viewUrl ? (
                  <img
                    src={v.viewUrl}
                    alt={`Thumbnail variant ${v.variant}`}
                    className={
                      aspect === "16:9"
                        ? "aspect-video w-full object-cover"
                        : "aspect-[9/16] w-full object-cover"
                    }
                  />
                ) : (
                  <div className="flex aspect-video items-center justify-center bg-muted text-xs text-muted-foreground">
                    Preview unavailable
                  </div>
                )}
                {v.selected && (
                  <span className="absolute right-1.5 top-1.5 rounded-full bg-primary p-1 text-primary-foreground">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                )}
                <span className="absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">
                  V{v.variant}
                </span>
                <div className="absolute inset-x-0 bottom-0 flex gap-1 bg-gradient-to-t from-black/80 to-transparent p-1.5 pt-5">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-6 flex-1 px-1 text-[11px]"
                    disabled={selectWinner.isPending}
                    onClick={() => toggleCompare(v.id)}
                  >
                    {compareIds.includes(v.id) ? "Uncompare" : "Compare"}
                  </Button>
                  {!v.selected && (
                    <Button
                      size="sm"
                      className="h-6 flex-1 px-1 text-[11px]"
                      disabled={selectWinner.isPending}
                      onClick={() => selectWinner.mutate(v.id)}
                    >
                      Winner
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {compared.length === 2 && (
          <div className="space-y-1.5 rounded-lg border p-3">
            <Label>Side-by-side compare</Label>
            <div className="grid grid-cols-2 gap-3">
              {compared.map((v) => (
                <div key={v.id} className="space-y-1">
                  {v.viewUrl && (
                    <img
                      src={v.viewUrl}
                      alt={`Variant ${v.variant}`}
                      className="w-full rounded border"
                    />
                  )}
                  <p className="text-xs text-muted-foreground">
                    Variant {v.variant} ·{" "}
                    {v.is_ai_generated ? `AI (${v.model ?? "unknown model"})` : "Uploaded"}
                  </p>
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={selectWinner.isPending}
                    onClick={() => selectWinner.mutate(v.id)}
                  >
                    Select as winner
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Phase-4 experiment linkage */}
        <div className="space-y-2 rounded-lg border p-3">
          <Label className="flex items-center gap-1.5">
            <FlaskConical className="h-3.5 w-3.5" /> Link winner to a packaging experiment
          </Label>
          <p className="text-xs text-muted-foreground">
            Records the thumbnail as an arm of an existing Phase-4 experiment (linkage only —
            experiment status and metrics live in Phase 4).
          </p>
          <div className="flex gap-2">
            <Input
              value={experimentId}
              onChange={(e) => setExperimentId(e.target.value)}
              placeholder="Experiment ID (uuid)"
              className="font-mono text-xs"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={
                linkArm.isPending || !experimentId.trim() || !visible.some((v) => v.selected)
              }
              onClick={() => {
                const winner = visible.find((v) => v.selected);
                if (winner) linkArm.mutate(winner.id);
              }}
            >
              {linkArm.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Link winner
            </Button>
          </div>
          {!visible.some((v) => v.selected) && (
            <p className="text-xs text-muted-foreground">Select a winner first.</p>
          )}
          {linkError && <p className="text-xs text-destructive">{linkError}</p>}
        </div>
      </div>
    </div>
  );
}
