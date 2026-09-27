/**
 * F20 Video Studio — per-project scene-based editing route.
 *
 * Tabs: Scenes (list, per-scene editor, regen, repair, reorder/add/delete),
 * Assemble (QC gate + exact quote → the EXISTING enqueueServerRender path),
 * Shorts (F24 recut planner → enqueue as kind "short" linked to the project).
 *
 * Scene durations shown here are ESTIMATES until measured from real audio.
 * Nothing here auto-publishes.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ImageIcon,
  Loader2,
  Mic,
  Play,
  Plus,
  RefreshCw,
  Scissors,
  Trash2,
  Wrench,
} from "lucide-react";
import {
  addStudioScene,
  deleteStudioScene,
  listStudioScenes,
  prepareStudioAssemble,
  regenerateSceneAudio,
  regenerateSceneVisual,
  reorderStudioScenes,
  updateStudioScene,
} from "@/lib/creation/video-studio/studio.functions";
import { repairScene } from "@/lib/creation/checkpoints/repair.functions";
import { planShort } from "@/lib/creation/shorts/shorts.functions";
import { enqueueServerRender } from "@/lib/server-renders.functions";
import { listRenders } from "@/lib/renders.functions";
import { qcStudioTimeline } from "@/lib/creation/video-studio/qc";
import type { QuoteSummary, StudioScene } from "@/lib/creation/video-studio/types";

export const Route = createFileRoute("/_authenticated/studio/$projectId")({
  head: () => ({
    meta: [{ title: "Video Studio — Vidora AI" }],
  }),
  component: VideoStudioPage,
});

type Tab = "scenes" | "assemble" | "shorts";

function checkpointChip(scene: StudioScene) {
  const state = scene.checkpoint?.state ?? "pending";
  const variants: Record<string, { label: string; className: string }> = {
    pending: { label: "pending", className: "bg-muted text-muted-foreground" },
    done: { label: "rendered", className: "bg-emerald-500/15 text-emerald-600" },
    failed: { label: "failed", className: "bg-destructive/15 text-destructive" },
    invalidated: { label: "needs re-render", className: "bg-amber-500/15 text-amber-600" },
  };
  const v = variants[state]!;
  return <Badge className={v.className}>{v.label}</Badge>;
}

function VideoStudioPage() {
  const { projectId } = Route.useParams();
  const [tab, setTab] = useState<Tab>("scenes");
  const queryClient = useQueryClient();
  const listFn = useServerFn(listStudioScenes);

  const studioQuery = useQuery({
    queryKey: ["studio", projectId],
    queryFn: () => listFn({ data: { projectId } }),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["studio", projectId] });

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/projects">
            <ArrowLeft className="mr-1 h-4 w-4" /> Projects
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">
            {studioQuery.data?.project.title ?? "Video Studio"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Scene-based editing. Durations are estimates until measured from real narration audio.
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        {(
          [
            { id: "scenes", label: "Scenes" },
            { id: "assemble", label: "Assemble & Render" },
            { id: "shorts", label: "Shorts" },
          ] as { id: Tab; label: string }[]
        ).map((t) => (
          <Button
            key={t.id}
            variant={tab === t.id ? "default" : "outline"}
            size="sm"
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {studioQuery.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}
      {studioQuery.isError && (
        <Alert>
          <AlertDescription>
            Could not load the studio: {(studioQuery.error as Error).message}
          </AlertDescription>
        </Alert>
      )}
      {studioQuery.data && (
        <>
          {tab === "scenes" && (
            <ScenesTab projectId={projectId} scenes={studioQuery.data.scenes} onChanged={refresh} />
          )}
          {tab === "assemble" && (
            <AssembleTab
              projectId={projectId}
              title={studioQuery.data.project.title}
              aspectRatio={studioQuery.data.project.aspectRatio}
            />
          )}
          {tab === "shorts" && <ShortsTab projectId={projectId} scenes={studioQuery.data.scenes} />}
        </>
      )}
    </div>
  );
}

/* ------------------------------- Scenes tab ------------------------------ */

function ScenesTab({
  projectId,
  scenes,
  onChanged,
}: {
  projectId: string;
  scenes: StudioScene[];
  onChanged: () => void;
}) {
  const updateFn = useServerFn(updateStudioScene);
  const reorderFn = useServerFn(reorderStudioScenes);
  const addFn = useServerFn(addStudioScene);
  const deleteFn = useServerFn(deleteStudioScene);

  const [adding, setAdding] = useState(false);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= scenes.length) return;
    const order = scenes.map((s) => s.id);
    const [id] = order.splice(from, 1);
    order.splice(to, 0, id!);
    reorderFn({ data: { projectId, sceneIds: order } })
      .then(onChanged)
      .catch((e: Error) => toast.error(`Reorder failed: ${e.message}`));
  };

  const onAdd = async () => {
    setAdding(true);
    try {
      await addFn({
        data: {
          projectId,
          narration: "New scene narration.",
          position: scenes.length + 1,
        },
      });
      toast.success("Scene added");
      onChanged();
    } catch (e) {
      toast.error(`Add failed: ${(e as Error).message}`);
    } finally {
      setAdding(false);
    }
  };

  const onDelete = async (sceneId: string) => {
    if (!window.confirm("Delete this scene? Its asset versions are kept in history.")) return;
    try {
      await deleteFn({ data: { projectId, sceneId } });
      toast.success("Scene deleted");
      onChanged();
    } catch (e) {
      toast.error(`Delete failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {scenes.length} scene{scenes.length === 1 ? "" : "s"}
        </p>
        <Button size="sm" onClick={onAdd} disabled={adding}>
          {adding ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-1 h-4 w-4" />
          )}
          Add scene
        </Button>
      </div>
      {scenes.map((scene, i) => (
        <SceneCard
          key={scene.id}
          scene={scene}
          isFirst={i === 0}
          isLast={i === scenes.length - 1}
          onMoveUp={() => move(i, i - 1)}
          onMoveDown={() => move(i, i + 1)}
          onDelete={() => onDelete(scene.id)}
          onChanged={onChanged}
          updateFn={updateFn}
        />
      ))}
      {scenes.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No scenes yet. Add your first scene to start editing.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SceneCard({
  scene,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onDelete,
  onChanged,
  updateFn,
}: {
  scene: StudioScene;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onChanged: () => void;
  updateFn: (args: {
    data: { sceneId: string; projectId: string; narration?: string; visualPrompt?: string };
  }) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [narration, setNarration] = useState(scene.narration);
  const [visualPrompt, setVisualPrompt] = useState(scene.visualPrompt ?? "");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [voiceId, setVoiceId] = useState("");
  const [repairKind, setRepairKind] = useState<"narration" | "audio" | "visual" | "timing">(
    "audio",
  );
  const [repairNote, setRepairNote] = useState("");

  const audioFn = useServerFn(regenerateSceneAudio);
  const visualFn = useServerFn(regenerateSceneVisual);
  const repairFn = useServerFn(repairScene);

  const dirty = narration !== scene.narration || visualPrompt !== (scene.visualPrompt ?? "");

  const onSave = async () => {
    setSaving(true);
    try {
      await updateFn({
        data: { sceneId: scene.id, projectId: scene.projectId, narration, visualPrompt },
      });
      toast.success("Scene updated");
      setEditing(false);
      onChanged();
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const runRegen = async (kind: "audio" | "visual") => {
    setBusy(kind);
    try {
      const result =
        kind === "audio"
          ? await audioFn({
              data: {
                sceneId: scene.id,
                projectId: scene.projectId,
                ...(voiceId.trim() ? { voiceId: voiceId.trim() } : {}),
              },
            })
          : await visualFn({ data: { sceneId: scene.id, projectId: scene.projectId } });
      if (result.ok) {
        toast.success(kind === "audio" ? "Narration audio regenerated" : "Visual regenerated");
        onChanged();
      } else {
        const err = result.error;
        toast.error(
          err?.code === "INSUFFICIENT_CREDITS"
            ? "Not enough credits — top up before regenerating."
            : `Regeneration failed: ${err?.message ?? "unknown error"}`,
        );
      }
    } catch (e) {
      toast.error(`Regeneration failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const runRepair = async () => {
    setBusy("repair");
    try {
      const result = await repairFn({
        data: {
          projectId: scene.projectId,
          sceneId: scene.id,
          kind: repairKind,
          note: repairNote.trim() ? repairNote.trim() : undefined,
        },
      });
      if (result.ok) {
        toast.success(result.ok ? `Repair: ${result.nextStep}` : "Repaired");
        setRepairNote("");
        onChanged();
      }
    } catch (e) {
      toast.error(`Repair failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const needsRepair =
    scene.checkpoint?.state === "failed" || scene.checkpoint?.state === "invalidated";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Scene {scene.sceneNumber}</CardTitle>
            {checkpointChip(scene)}
            {!scene.assetUrl && <Badge variant="outline">no visual</Badge>}
            {!scene.audioUrl && <Badge variant="outline">no audio</Badge>}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              disabled={isFirst}
              onClick={onMoveUp}
              title="Move up"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={isLast}
              onClick={onMoveDown}
              title="Move down"
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onDelete} title="Delete scene">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-4">
          <div className="h-20 w-36 shrink-0 overflow-hidden rounded bg-muted">
            {(scene.assetThumbUrl ?? scene.assetUrl) ? (
              <img
                src={scene.assetThumbUrl ?? scene.assetUrl ?? ""}
                alt={`Scene ${scene.sceneNumber} visual`}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <ImageIcon className="h-6 w-6" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-xs text-muted-foreground">
              ≈ {scene.durationSecEstimate.toFixed(1)}s estimate · status {scene.status}
            </p>
            {editing ? (
              <div className="space-y-2">
                <Label>Narration</Label>
                <Textarea
                  value={narration}
                  onChange={(e) => setNarration(e.target.value)}
                  rows={3}
                />
                <Label>Visual prompt</Label>
                <Textarea
                  value={visualPrompt}
                  onChange={(e) => setVisualPrompt(e.target.value)}
                  rows={2}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={onSave} disabled={saving || !dirty}>
                    {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />} Save
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditing(false);
                      setNarration(scene.narration);
                      setVisualPrompt(scene.visualPrompt ?? "");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-sm">{scene.narration}</p>
                {scene.visualPrompt && (
                  <p className="text-xs text-muted-foreground">Prompt: {scene.visualPrompt}</p>
                )}
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              </div>
            )}
          </div>
        </div>

        <Separator />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => runRegen("audio")}
          >
            {busy === "audio" ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Mic className="mr-1 h-3 w-3" />
            )}
            Regenerate audio
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => runRegen("visual")}
          >
            {busy === "visual" ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-3 w-3" />
            )}
            Regenerate visual
          </Button>
          <Input
            className="w-44"
            placeholder="Voice ID (optional)"
            value={voiceId}
            onChange={(e) => setVoiceId(e.target.value)}
          />
          <span className="text-xs text-muted-foreground">
            Credit cost is preflighted before anything is spent; failed generations are refunded.
          </span>
        </div>

        {needsRepair && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="mb-2 text-sm font-medium">
              <Wrench className="mr-1 inline h-3 w-3" />
              Repair this scene
              {scene.checkpoint?.state === "failed"
                ? `: ${scene.checkpoint.error}`
                : scene.checkpoint?.state === "invalidated"
                  ? `: ${scene.checkpoint.reason}`
                  : ""}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={repairKind}
                onValueChange={(v) =>
                  setRepairKind(v as "narration" | "audio" | "visual" | "timing")
                }
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="narration">narration (edit + new audio)</SelectItem>
                  <SelectItem value="audio">audio (regenerate from text)</SelectItem>
                  <SelectItem value="visual">visual (regenerate image)</SelectItem>
                  <SelectItem value="timing">timing (free correction)</SelectItem>
                </SelectContent>
              </Select>
              <Input
                className="w-56"
                placeholder="Note (optional)"
                value={repairNote}
                onChange={(e) => setRepairNote(e.target.value)}
              />
              <Button size="sm" onClick={runRepair} disabled={busy !== null}>
                {busy === "repair" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                Mark for re-render
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------ Assemble tab ----------------------------- */

function AssembleTab({
  projectId,
  title,
  aspectRatio,
}: {
  projectId: string;
  title: string;
  aspectRatio: string;
}) {
  const prepareFn = useServerFn(prepareStudioAssemble);
  const enqueueFn = useServerFn(enqueueServerRender);
  const [aspects, setAspects] = useState<string[]>([aspectRatio === "9:16" ? "9:16" : "16:9"]);
  const [burnCaptions, setBurnCaptions] = useState(true);
  const [storyMode, setStoryMode] = useState(true);
  const [parallax25d, setParallax25d] = useState(false);

  const prepareMutation = useMutation({
    mutationFn: (data: {
      projectId: string;
      aspects: string[];
      burnCaptions: boolean;
      storyMode: boolean;
      parallax25d: boolean;
    }) => prepareFn({ data }),
  });

  const enqueueMutation = useMutation({
    mutationFn: async () => {
      const prepared = prepareMutation.data;
      if (!prepared) throw new Error("Prepare the timeline first.");
      return enqueueFn({
        data: {
          projectId,
          title,
          scenes: prepared.scenes,
          aspects: aspects as ("16:9" | "9:16" | "1:1")[],
          burnCaptions,
          musicUrl: null,
          storyMode,
          parallax25d,
        },
      });
    },
  });

  const prepared = prepareMutation.data;
  const qc = prepared ? qcStudioTimeline(prepared.scenes) : null;

  const toggleAspect = (a: string) =>
    setAspects((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));

  const quote: QuoteSummary | null = prepared?.quote ?? null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Assemble timeline</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-sm font-medium">Formats (F20 supports 16:9 and 9:16):</span>
            {["16:9", "9:16", "1:1"].map((a) => (
              <label key={a} className="flex items-center gap-1 text-sm">
                <Checkbox checked={aspects.includes(a)} onCheckedChange={() => toggleAspect(a)} />
                {a}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={burnCaptions} onCheckedChange={setBurnCaptions} /> Burn captions
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={storyMode} onCheckedChange={setStoryMode} /> Story mode
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={parallax25d} onCheckedChange={setParallax25d} /> 2.5D parallax (+0.25
              credits/min)
            </label>
          </div>
          <Button
            onClick={() =>
              prepareMutation.mutate({
                projectId,
                aspects,
                burnCaptions,
                storyMode,
                parallax25d,
              })
            }
            disabled={prepareMutation.isPending || aspects.length === 0}
          >
            {prepareMutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Prepare timeline &amp; quote
          </Button>
          {prepareMutation.isError && (
            <Alert>
              <AlertDescription>
                Prepare failed: {(prepareMutation.error as Error).message}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {prepared && qc && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quality gate</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <ul className="space-y-1 text-sm">
              {qc.checks.map((c, i) => (
                <li key={i} className="flex items-start gap-2">
                  <Badge
                    className={
                      c.passed
                        ? "bg-emerald-500/15 text-emerald-600"
                        : "bg-destructive/15 text-destructive"
                    }
                  >
                    {c.passed ? "pass" : "fail"}
                  </Badge>
                  <span>
                    <span className="font-medium">{c.name}</span>: {c.detail}
                  </span>
                </li>
              ))}
            </ul>
            {qc.blocking.length > 0 && (
              <p className="text-sm text-destructive">
                Blocking: {qc.blocking.join(", ")} — fix these before enqueueing.
              </p>
            )}
            {prepared.missingVisuals > 0 && (
              <p className="text-sm text-destructive">
                {prepared.missingVisuals} scene(s) still missing visuals — render is blocked until
                they are generated.
              </p>
            )}
            <Separator />
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div>
                <p className="text-muted-foreground">Scenes</p>
                <p className="font-medium">{prepared.scenes.length}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Est. duration</p>
                <p className="font-medium">
                  ≈ {prepared.scenes.reduce((a, s) => a + s.duration, 0).toFixed(1)}s
                </p>
              </div>
              {quote && (
                <>
                  <div>
                    <p className="text-muted-foreground">Estimated credits (all formats)</p>
                    <p className="font-medium">{quote.grandTotalCredits.toFixed(1)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Per format</p>
                    <p className="font-medium">
                      {quote.perAspectCredits.toFixed(1)} credits ·{" "}
                      {quote.minutesPerAspect.toFixed(1)} min
                    </p>
                  </div>
                </>
              )}
            </div>
            <Button
              onClick={() => enqueueMutation.mutate()}
              disabled={!qc.passed || enqueueMutation.isPending}
            >
              {enqueueMutation.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-1 h-4 w-4" />
              )}
              Enqueue server render
            </Button>
            {!qc.passed && (
              <p className="text-xs text-muted-foreground">
                Fix the blocking checks above before enqueueing. Preflight runs server-side before
                any credits are debited.
              </p>
            )}
            {enqueueMutation.isSuccess && (
              <Alert>
                <AlertDescription>
                  Render enqueued ({enqueueMutation.data.rows.length} job(s)). Durable server-side —
                  it survives tab close. The worker is not yet deployed, so execution waits for
                  deployment.
                </AlertDescription>
              </Alert>
            )}
            {enqueueMutation.isError && (
              <Alert>
                <AlertDescription>
                  Enqueue failed: {(enqueueMutation.error as Error).message}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------- Shorts tab ------------------------------ */

function ShortsTab({ projectId, scenes }: { projectId: string; scenes: StudioScene[] }) {
  const planFn = useServerFn(planShort);
  const enqueueFn = useServerFn(enqueueServerRender);
  const listRendersFn = useServerFn(listRenders);
  const [selected, setSelected] = useState<string[]>(scenes.map((s) => s.id));
  const [maxDurationSec, setMaxDurationSec] = useState(60);
  /** Optional source render for renders.parent_id lineage (null = cut from project scenes). */
  const [sourceRenderId, setSourceRenderId] = useState<string | null>(null);

  const rendersQuery = useQuery({
    queryKey: ["renders", projectId],
    queryFn: () => listRendersFn({ data: { projectId } }),
  });
  const completedRenders = (rendersQuery.data ?? []).filter((r) => r.status === "completed");

  const planMutation = useMutation({
    mutationFn: (data: { projectId: string; sceneIds: string[]; maxDurationSec: number }) =>
      planFn({ data }),
  });

  const enqueueMutation = useMutation({
    mutationFn: async () => {
      const plan = planMutation.data;
      if (!plan) throw new Error("Plan a short first.");
      return enqueueFn({
        data: {
          projectId,
          title: plan.plan.title,
          scenes: plan.enqueueScenes,
          aspects: ["9:16"],
          burnCaptions: true,
          musicUrl: null,
          storyMode: true,
          parentId: sourceRenderId,
          kind: "short",
        },
      });
    },
  });

  const plan = planMutation.data;

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <Scissors className="mr-1 inline h-4 w-4" /> Plan a 9:16 short
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Reuses finished scenes with hook-first resequencing and tightened narration. Never
            auto-publishes — enqueueing creates a render job you can review first.
          </p>
          <div className="space-y-1">
            {scenes.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={selected.includes(s.id)} onCheckedChange={() => toggle(s.id)} />
                Scene {s.sceneNumber} — {s.narration.slice(0, 60)}
                {s.narration.length > 60 ? "…" : ""}
                {!s.assetUrl && <Badge variant="outline">no visual</Badge>}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Label>Max duration (s)</Label>
            <Input
              type="number"
              className="w-24"
              value={maxDurationSec}
              onChange={(e) => setMaxDurationSec(Number(e.target.value))}
              min={15}
              max={180}
            />
          </div>
          <Button
            onClick={() => planMutation.mutate({ projectId, sceneIds: selected, maxDurationSec })}
            disabled={planMutation.isPending || selected.length === 0}
          >
            {planMutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Plan short
          </Button>
          {planMutation.isError && (
            <Alert>
              <AlertDescription>
                Plan failed: {(planMutation.error as Error).message}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {plan && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{plan.plan.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="space-y-1">
              <p>
                <span className="font-medium">Hook:</span> {plan.plan.hookAnalysisNote}
              </p>
              <p>
                <span className="font-medium">Resequencing:</span> {plan.plan.resequencingNote}
              </p>
              <p>
                <span className="font-medium">Est. duration:</span> ≈{" "}
                {plan.plan.estimatedDurationSec.toFixed(1)}s ·{" "}
                <span className="font-medium">Credits:</span>{" "}
                {plan.quote.grandTotalCredits.toFixed(1)}
              </p>
              <p className="text-muted-foreground">Hashtags: {plan.plan.hashtags.join(" ")}</p>
            </div>
            <ol className="list-decimal space-y-1 pl-5">
              {plan.plan.scenes.map((o) => (
                <li key={o.sceneId}>
                  {o.sceneId === plan.plan.hookSceneId ? <strong>HOOK — </strong> : ""}
                  {o.recutNarration}
                  <span className="text-muted-foreground">
                    {" "}
                    (≈ {o.durationSecEstimate.toFixed(0)}s)
                  </span>
                </li>
              ))}
            </ol>
            {plan.plan.missingVisuals > 0 ? (
              <Alert>
                <AlertDescription>
                  {plan.plan.missingVisuals} selected scene(s) are missing visuals — generate them
                  in the Scenes tab before enqueueing the short.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>Lineage (optional)</Label>
                  <Select
                    value={sourceRenderId ?? "none"}
                    onValueChange={(v) => setSourceRenderId(v === "none" ? null : v)}
                  >
                    <SelectTrigger className="w-64">
                      <SelectValue placeholder="Cut from project scenes" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">
                        Cut from project scenes (no parent render)
                      </SelectItem>
                      {completedRenders.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          Short of {r.aspect_ratio} render ·{" "}
                          {new Date(r.created_at).toLocaleDateString()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={() => enqueueMutation.mutate()}
                  disabled={enqueueMutation.isPending}
                >
                  {enqueueMutation.isPending ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="mr-1 h-4 w-4" />
                  )}
                  Enqueue short (9:16)
                </Button>
              </div>
            )}
            {enqueueMutation.isSuccess && (
              <Alert>
                <AlertDescription>
                  Short enqueued ({enqueueMutation.data.rows.length} job). It is linked to this
                  project and will not publish automatically.
                </AlertDescription>
              </Alert>
            )}
            {enqueueMutation.isError && (
              <Alert>
                <AlertDescription>
                  Enqueue failed: {(enqueueMutation.error as Error).message}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
