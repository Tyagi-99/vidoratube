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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThumbnailProjectEditor } from "./ThumbnailProjectEditor";
import { SurfacePreview } from "./thumbnails/SurfacePreview";
import { useI18n } from "@/lib/i18n";
import {
  generateThumbnails,
  listThumbnails,
  selectThumbnail,
  updateThumbnailOverlay,
  uploadFinalThumbnailImage,
} from "@/lib/publish.functions";
import type { TextOverlay, ThumbnailAspect } from "@/lib/thumbnails";

const FONTS: TextOverlay["font"][] = ["bold-sans", "condensed", "serif-display", "mono"];
const POSITIONS: TextOverlay["position"][] = ["top", "center", "bottom"];

const FONT_STACKS: Record<TextOverlay["font"], string> = {
  "bold-sans": "900 96px system-ui, sans-serif",
  condensed: "800 96px 'Arial Narrow', sans-serif",
  "serif-display": "900 96px Georgia, serif",
  mono: "800 88px ui-monospace, monospace",
};

/** Burns the text overlay onto the image via canvas, returns a JPEG data URL. */
async function burnOverlay(
  imageUrl: string,
  overlay: {
    headline: string;
    font: TextOverlay["font"];
    color: string;
    position: TextOverlay["position"];
  },
): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Could not load thumbnail image."));
    el.src = imageUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not available.");
  ctx.drawImage(img, 0, 0);

  const fontSize = Math.round(canvas.width / 12);
  const stack = FONT_STACKS[overlay.font].replace(/\d+px/, `${fontSize}px`);
  ctx.font = stack;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Word-wrap the headline.
  const words = overlay.headline.toUpperCase().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > canvas.width * 0.9 && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);

  const lineHeight = fontSize * 1.15;
  const blockHeight = lines.length * lineHeight;
  const yBase =
    overlay.position === "top"
      ? blockHeight / 2 + canvas.height * 0.08
      : overlay.position === "bottom"
        ? canvas.height - blockHeight / 2 - canvas.height * 0.08
        : canvas.height / 2;

  ctx.lineWidth = Math.max(4, fontSize / 12);
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.fillStyle = overlay.color;
  lines.forEach((ln, i) => {
    const y = yBase - blockHeight / 2 + lineHeight / 2 + i * lineHeight;
    ctx.strokeText(ln, canvas.width / 2, y);
    ctx.fillText(ln, canvas.width / 2, y);
  });
  return canvas.toDataURL("image/jpeg", 0.92);
}

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

  const [burnPreview, setBurnPreview] = useState<string | null>(null);
  const burnFn = useServerFn(uploadFinalThumbnailImage);

  const burnAndUpload = useMutation({
    mutationFn: async (thumb: { id: string; viewUrl: string | null }) => {
      if (!thumb.viewUrl) throw new Error("Thumbnail image not loaded yet.");
      if (!headline.trim()) throw new Error("Add a headline first.");
      const dataUrl = await burnOverlay(thumb.viewUrl, { headline, font, color, position });
      setBurnPreview(dataUrl);
      await burnFn({ data: { thumbnail_id: thumb.id, image_data_url: dataUrl } });
      // Persist the overlay spec too.
      await overlayFn({
        data: { thumbnail_id: thumb.id, headline, font, color, position, fontSize: "lg" },
      });
    },
    onSuccess: () => {
      toast.success("Overlay burned and saved");
      queryClient.invalidateQueries({ queryKey: ["thumbnails", projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const visible = (thumbs.data?.thumbnails ?? []).filter((x) => x.aspect === aspect);
  const selected = visible.find((x) => x.selected);
  const provenance = selected
    ? [
        selected.is_ai_generated ? "AI-generated" : "Uploaded",
        selected.model,
        selected.created_at ? new Date(selected.created_at).toLocaleDateString() : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t("thumbnail_studio")}</h3>
        <TabsList>
          <TabsTrigger value="variants">Variants</TabsTrigger>
          <TabsTrigger value="editor">Layered editor</TabsTrigger>
          <TabsTrigger value="preview">Surface preview</TabsTrigger>
        </TabsList>
      </div>
      <Tabs defaultValue="variants">
        <TabsContent value="variants" className="space-y-4">
          <div className="flex items-center justify-end gap-2">
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
              {generate.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ImageIcon className="h-4 w-4" />
              )}
              {generate.isPending ? t("generating_thumbnails") : t("generate_thumbnails")}
            </Button>
          </div>

          {thumbs.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Generate 4 AI thumbnail variants to get started.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
                      className={
                        aspect === "16:9"
                          ? "aspect-video w-full object-cover"
                          : "aspect-[9/16] w-full object-cover"
                      }
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

          {provenance && (
            <p className="text-xs text-muted-foreground">
              Selected variant {selected?.variant}: {provenance}
            </p>
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
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FONTS.map((f) => (
                        <SelectItem key={f} value={f}>
                          {f}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t("thumbnail_color")}</Label>
                  <Input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="h-10 w-full cursor-pointer p-1"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("thumbnail_position")}</Label>
                  <Select
                    value={position}
                    onValueChange={(v) => setPosition(v as TextOverlay["position"])}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {POSITIONS.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => saveOverlay.mutate(selected.id)}
                  disabled={saveOverlay.isPending || !headline.trim()}
                >
                  {saveOverlay.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                  Save overlay
                </Button>
                <Button
                  size="sm"
                  onClick={() => burnAndUpload.mutate(selected)}
                  disabled={burnAndUpload.isPending || !headline.trim()}
                >
                  {burnAndUpload.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                  Burn text into image
                </Button>
              </div>
              {burnPreview && (
                <div className="space-y-1.5">
                  <Label>Preview (what YouTube will show)</Label>
                  <img
                    src={burnPreview}
                    alt="Burned thumbnail preview"
                    className="w-full rounded-lg border"
                  />
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                “Burn text into image” bakes the headline onto the thumbnail — this is the version
                uploaded to YouTube.
              </p>
            </div>
          )}
        </TabsContent>
        <TabsContent value="editor">
          <ThumbnailProjectEditor
            projectId={projectId}
            videoTitle={videoTitle}
            videoTopic={videoTopic}
          />
        </TabsContent>
        <TabsContent value="preview">
          {/* P6 Stream E (P4): surface preview of the selected/burned thumbnail. */}
          {burnPreview || selected?.viewUrl ? (
            <SurfacePreview
              imageUrl={(burnPreview ?? selected?.viewUrl) as string}
              videoTitle={videoTitle}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              Select a variant first — the surface preview shows how it reads at real
              display sizes across feed, search, suggested, mobile, and channel views.
            </p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
