/**
 * F9 Visual Research — per-project research canvas.
 *
 * Beginner-readable source board: add / edit / remove / reorder sources,
 * each with a type badge, published date, freshness/stale flag, linked-claim
 * count, and an honest link out to the original. Trend Radar citations
 * (metadata.generated_by === "trend-radar") get their own badge.
 *
 * States: loading, error (+retry), empty, populated. No fake drag-and-drop
 * — reorder uses explicit up/down buttons (accessible, honest).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ExternalLink, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import type { Json } from "@/integrations/supabase/types";
import {
  addCanvasSource,
  listCanvasSources,
  removeCanvasSource,
  reorderCanvasSources,
  updateCanvasSource,
} from "@/lib/creation/research-canvas/research-canvas.functions";
import {
  SOURCE_TYPE_BADGES,
  type CanvasSource,
  type ResearchSourceType,
} from "@/lib/creation/research-canvas/types";
import { formatSourceDate, isSourceStale } from "@/lib/creation/research-canvas/format";

const SOURCE_TYPES = Object.keys(SOURCE_TYPE_BADGES) as ResearchSourceType[];

/** Trend Radar rows mark themselves in metadata — surfaced as a badge. */
function isTrendRadarSource(s: CanvasSource): boolean {
  const m = s.metadata;
  return (
    typeof m === "object" &&
    m !== null &&
    !Array.isArray(m) &&
    (m as Record<string, Json>)["generated_by"] === "trend-radar"
  );
}

type SourceFormValues = {
  sourceType: ResearchSourceType;
  url: string;
  title: string;
  excerpt: string;
  publishedAt: string;
};

function SourceForm({
  initial,
  onSubmit,
  onCancel,
  saving,
}: {
  initial: SourceFormValues;
  onSubmit: (v: SourceFormValues) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const { t } = useI18n();
  const [v, setV] = useState(initial);
  const set =
    (k: keyof SourceFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setV((prev) => ({ ...prev, [k]: e.target.value }));

  return (
    <form
      className="space-y-3 rounded-lg border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>{t("canvas_type")}</Label>
          <Select
            value={v.sourceType}
            onValueChange={(val) =>
              setV((prev) => ({ ...prev, sourceType: val as ResearchSourceType }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_TYPES.map((st) => (
                <SelectItem key={st} value={st}>
                  {SOURCE_TYPE_BADGES[st].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t("canvas_published")}</Label>
          <Input type="date" value={v.publishedAt} onChange={set("publishedAt")} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>{t("canvas_title_label")}</Label>
        <Input value={v.title} onChange={set("title")} maxLength={200} required />
      </div>
      <div className="space-y-1.5">
        <Label>{t("canvas_url")}</Label>
        <Input value={v.url} onChange={set("url")} placeholder="https://…" inputMode="url" />
      </div>
      <div className="space-y-1.5">
        <Label>{t("canvas_excerpt")}</Label>
        <Textarea value={v.excerpt} onChange={set("excerpt")} rows={3} maxLength={2000} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={saving || v.title.trim().length === 0}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {saving ? t("canvas_saving") : t("canvas_save")}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("canvas_cancel")}
        </Button>
      </div>
    </form>
  );
}

function SourceCard({
  source,
  isFirst,
  isLast,
  onEdit,
  onDelete,
  onMove,
  moving,
}: {
  source: CanvasSource;
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  moving: boolean;
}) {
  const { t } = useI18n();
  const badge = SOURCE_TYPE_BADGES[source.source_type];
  const stale = isSourceStale(source.published_at);
  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" title={badge.hint}>
          {badge.label}
        </Badge>
        {isTrendRadarSource(source) && <Badge variant="outline">{t("canvas_trend_radar")}</Badge>}
        <span className="text-xs text-muted-foreground">
          {t("canvas_published_label")}: {formatSourceDate(source.published_at)}
        </span>
        {stale && (
          <Badge variant="destructive" title={t("canvas_stale")}>
            {t("canvas_stale_short")}
          </Badge>
        )}
        {source.claimCount > 0 && (
          <Badge variant="outline">
            {source.claimCount} {t("canvas_claims")}
          </Badge>
        )}
      </div>
      <h4 className="mt-2 font-semibold text-foreground">
        {source.url ? (
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:underline"
          >
            {source.title}
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          </a>
        ) : (
          source.title
        )}
      </h4>
      {source.excerpt && (
        <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{source.excerpt}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onMove(-1)}
          disabled={isFirst || moving}
          title={t("canvas_move_up")}
          aria-label={t("canvas_move_up")}
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onMove(1)}
          disabled={isLast || moving}
          title={t("canvas_move_down")}
          aria-label={t("canvas_move_down")}
        >
          <ArrowDown className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={onEdit} className="gap-1.5">
          <Pencil className="h-3.5 w-3.5" />
          {t("canvas_edit")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete} className="gap-1.5 text-destructive">
          <Trash2 className="h-3.5 w-3.5" />
          {t("canvas_delete")}
        </Button>
      </div>
    </div>
  );
}

export function ResearchCanvas({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const listFn = useServerFn(listCanvasSources);
  const addFn = useServerFn(addCanvasSource);
  const updateFn = useServerFn(updateCanvasSource);
  const removeFn = useServerFn(removeCanvasSource);
  const reorderFn = useServerFn(reorderCanvasSources);

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const canvas = useQuery({
    queryKey: ["research-canvas", projectId],
    queryFn: () => listFn({ data: { projectId } }),
  });
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["research-canvas", projectId] });

  const addMut = useMutation({
    mutationFn: (v: SourceFormValues) =>
      addFn({
        data: {
          projectId,
          sourceType: v.sourceType,
          url: v.url.trim() || "",
          title: v.title.trim(),
          excerpt: v.excerpt.trim(),
          publishedAt: v.publishedAt || null,
        },
      }),
    onSuccess: () => {
      setAdding(false);
      invalidate();
      toast.success(t("canvas_added"));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("canvas_error")),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, v }: { id: string; v: SourceFormValues }) =>
      updateFn({
        data: {
          id,
          title: v.title.trim(),
          excerpt: v.excerpt.trim(),
          publishedAt: v.publishedAt || null,
        },
      }),
    onSuccess: () => {
      setEditingId(null);
      invalidate();
      toast.success(t("canvas_updated"));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("canvas_error")),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => removeFn({ data: { id } }),
    onSuccess: () => {
      setConfirmDeleteId(null);
      invalidate();
      toast.success(t("canvas_deleted"));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("canvas_error")),
  });

  const reorderMut = useMutation({
    mutationFn: (orderedIds: string[]) => reorderFn({ data: { projectId, orderedIds } }),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : t("canvas_error")),
  });

  const sources = canvas.data ?? [];
  const move = (index: number, dir: -1 | 1) => {
    const ids = sources.map((s) => s.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    const [id] = ids.splice(index, 1);
    ids.splice(j, 0, id!);
    reorderMut.mutate(ids);
  };

  const blankForm: SourceFormValues = {
    sourceType: "web",
    url: "",
    title: "",
    excerpt: "",
    publishedAt: "",
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{t("canvas_title")}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t("canvas_subtitle")}</p>
        </div>
        {!adding && (
          <Button onClick={() => setAdding(true)} className="gap-1.5">
            <Plus className="h-4 w-4" />
            {t("canvas_add")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {adding && (
          <SourceForm
            initial={blankForm}
            saving={addMut.isPending}
            onCancel={() => setAdding(false)}
            onSubmit={(v) => addMut.mutate(v)}
          />
        )}

        {canvas.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("canvas_loading")}
          </div>
        )}

        {canvas.isError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <p className="text-destructive">{t("canvas_error")}</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => canvas.refetch()}>
              {t("canvas_retry")}
            </Button>
          </div>
        )}

        {canvas.isSuccess && sources.length === 0 && !adding && (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <p className="font-medium text-foreground">{t("canvas_empty_title")}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              {t("canvas_empty_body")}
            </p>
            <Button className="mt-4 gap-1.5" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" />
              {t("canvas_add_first")}
            </Button>
          </div>
        )}

        {sources.map((s, i) =>
          editingId === s.id ? (
            <SourceForm
              key={s.id}
              initial={{
                sourceType: s.source_type,
                url: s.url ?? "",
                title: s.title,
                excerpt: s.excerpt ?? "",
                publishedAt: (s.published_at ?? "").slice(0, 10),
              }}
              saving={updateMut.isPending}
              onCancel={() => setEditingId(null)}
              onSubmit={(v) => updateMut.mutate({ id: s.id, v })}
            />
          ) : confirmDeleteId === s.id ? (
            <div key={s.id} className="rounded-lg border border-destructive/40 p-4">
              <p className="text-sm font-medium">{t("canvas_delete_confirm")}</p>
              <p className="mt-1 truncate text-sm text-muted-foreground">{s.title}</p>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={removeMut.isPending}
                  onClick={() => removeMut.mutate(s.id)}
                >
                  {removeMut.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                  {t("canvas_confirm_delete")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConfirmDeleteId(null)}>
                  <X className="mr-1.5 h-3.5 w-3.5" />
                  {t("canvas_cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <SourceCard
              key={s.id}
              source={s}
              isFirst={i === 0}
              isLast={i === sources.length - 1}
              moving={reorderMut.isPending}
              onEdit={() => setEditingId(s.id)}
              onDelete={() => setConfirmDeleteId(s.id)}
              onMove={(dir) => move(i, dir)}
            />
          ),
        )}
      </CardContent>
    </Card>
  );
}
