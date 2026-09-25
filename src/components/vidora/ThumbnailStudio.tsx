import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ImageIcon, Loader2, Check } from "lucide-react";
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
import { useI18n } from "@/lib/i18n";
import {
  generateThumbnails,
  listThumbnails,
  selectThumbnail,
  updateThumbnailOverlay,
} from "@/lib/publish.functions";
import type { TextOverlay, ThumbnailAspect } from "@/lib/thumbnails";

const FONTS: TextOverlay["font"][] = ["bold-sans", "condensed", "serif-display", "mono"];
const POSITIONS: TextOverlay["position"][] = ["top", "center", "bottom"];

export function ThumbnailStudio({
  projectId,
  videoTitle,
  videoTopic,
}: {
  projectId: string;
  videoTitle: string;
  videoTopic: string;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const genFn = useServerFn(generateThumbnails);
  const listFn = useServerFn(listThumbnails);
  const selectFn = useServerFn(selectThumbnail);
  const overlayFn = useServerFn(updateThumbnailOverlay);

  const [aspect, setAspect] = useState<ThumbnailAspect>("16:9");
  const [headline, setHeadline] = useState("");
  const [font, setFont] = useState<TextOverlay["font"]>("bold-sans");
  const [color, setColor] = useState("#FFFFFF");
  const [position, setPosition] = useState<TextOverlay["position"]>("bottom");

  const thumbs = useQuery({
    queryKey: ["thumbnails", projectId],
    queryFn: () => listFn({ data: { project_id: projectId } }),
  });

  const generate = useMutation({
    mutationFn: () =>
      genFn({
        data: {
          project_id: projectId,
          video_title: videoTitle,
          video_topic: videoTopic,
        },
      }),
    onSuccess: () => {
      toast.success("Thumbnails generated");
      queryClient.invalidateQueries({ queryKey: ["thumbnails", projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const select = useMutation({
    mutationFn: (id: string) => selectFn({ data: { thumbnail_id: id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["thumbnails", projectId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const saveOverlay = useMutation({
    mutationFn: (id: string) =>
      overlayFn({
        data: {
          thumbnail_id: id,
          headline,
          font,
          color,
          position,
          fontSize: "lg",
        },
      }),
    onSuccess: () => toast.success("Text overlay saved"),
    onError: (e: Error) => toast.error(e.message),
  });

  const visible = (thumbs.data?.thumbnails ?? []).filter((x) => x.aspect === aspect);
  const selected = visible.find((x) => x.selected);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t("thumbnail_studio")}</h3>
        <div className="flex gap-2">
          <Select value={aspect} onValueChange={(v) => setAspect(v as ThumbnailAspect)}>
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="16:9">16:9</SelectItem>
              <SelectItem value="9:16">9:16</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => generate.mutate()} disabled={generate.isPending}>
            {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
            {generate.isPending ? t("generating_thumbnails") : t("generate_thumbnails")}
          </Button>
        </div>
      </div>

      {thumbs.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Generate 3 AI thumbnail variants to get started.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {visible.map((thumb) => (
            <button
              key={thumb.id}
              type="button"
              onClick={() => select.mutate(thumb.id)}
              className={`relative overflow-hidden rounded-lg border-2 transition-colors ${
                thumb.selected ? "border-primary" : "border-transparent hover:border-muted"
              }`}
            >
              {thumb.viewUrl ? (
                <img
                  src={thumb.viewUrl}
                  alt={`Thumbnail variant ${thumb.variant}`}
                  className={aspect === "16:9" ? "aspect-video w-full object-cover" : "aspect-[9/16] w-full object-cover"}
                />
              ) : (
                <div className="flex aspect-video items-center justify-center bg-muted">
                  <ImageIcon className="h-6 w-6 text-muted-foreground" />
                </div>
              )}
              {thumb.selected && (
                <span className="absolute right-1.5 top-1.5 rounded-full bg-primary p-1 text-primary-foreground">
                  <Check className="h-3.5 w-3.5" />
                </span>
              )}
              <span className="absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">
                {thumb.variant}
              </span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="space-y-3 rounded-lg border p-4">
          <div className="space-y-1.5">
            <Label>{t("thumbnail_headline")}</Label>
            <Input
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="YOUR HEADLINE HERE"
              maxLength={60}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>{t("thumbnail_font")}</Label>
              <Select value={font} onValueChange={(v) => setFont(v as TextOverlay["font"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FONTS.map((f) => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("thumbnail_color")}</Label>
              <Input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-full cursor-pointer p-1" />
            </div>
            <div className="space-y-1.5">
              <Label>{t("thumbnail_position")}</Label>
              <Select value={position} onValueChange={(v) => setPosition(v as TextOverlay["position"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {POSITIONS.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => saveOverlay.mutate(selected.id)}
            disabled={saveOverlay.isPending || !headline.trim()}
          >
            {saveOverlay.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Save overlay
          </Button>
          <p className="text-xs text-muted-foreground">
            The text is burned onto the thumbnail image when you publish.
          </p>
        </div>
      )}
    </div>
  );
}
