/**
 * F15 — layered canvas editor (visual editing surface for thumbnail_projects).
 *
 * Renders the canvas state from `thumbnail_projects.canvas` and edits it with
 * the pure ops in `src/lib/creation/thumbnails/canvas.ts`. Persistence is the
 * parent's job (save → `saveThumbnailCanvas`).
 */
import { useState } from "react";
import { ArrowDown, ArrowUp, Image as ImageIcon, Plus, Trash2, Type } from "lucide-react";
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
import {
  CANVAS_DIMS,
  addLayer,
  bringForward,
  moveLayer,
  removeLayer,
  resizeLayer,
  sendBackward,
  setBackground,
  type CanvasAspect,
  type CanvasLayer,
  type CanvasState,
} from "@/lib/creation/thumbnails/canvas";

const FONTS = ["bold-sans", "condensed", "serif-display", "mono"] as const;
const FONT_LABEL: Record<(typeof FONTS)[number], string> = {
  "bold-sans": "Bold sans",
  condensed: "Condensed",
  "serif-display": "Serif display",
  mono: "Mono",
};

function newId(): string {
  return crypto.randomUUID();
}

export function LayeredCanvasEditor({
  canvas,
  aspect,
  onChange,
  disabled = false,
}: {
  canvas: CanvasState;
  aspect: CanvasAspect;
  onChange: (canvas: CanvasState) => void;
  disabled?: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newText, setNewText] = useState("");
  const [newImageSrc, setNewImageSrc] = useState("");
  const [bgImageUrl, setBgImageUrl] = useState("");

  const dims = CANVAS_DIMS[aspect];
  const selected = canvas.layers.find((l) => l.id === selectedId) ?? null;
  const sorted = [...canvas.layers].sort((a, b) => b.zIndex - a.zIndex);

  const patch = (fn: (s: CanvasState) => CanvasState) => {
    if (!disabled) onChange(fn(canvas));
  };

  const addTextLayer = () => {
    if (!newText.trim()) return;
    patch((s) =>
      addLayer(s, {
        id: newId(),
        kind: "text",
        name: newText.trim().slice(0, 40),
        x: 0.1,
        y: 0.68,
        width: 0.8,
        height: 0.22,
        rotation: 0,
        zIndex: 0,
        text: {
          content: newText.trim().toUpperCase(),
          font: "bold-sans",
          color: "#FFFFFF",
          align: "center",
        },
        image: null,
      } as CanvasLayer),
    );
    setNewText("");
  };

  const addImageLayer = () => {
    if (!newImageSrc.trim()) return;
    patch((s) =>
      addLayer(s, {
        id: newId(),
        kind: "image",
        name: "Image",
        x: 0.55,
        y: 0.05,
        width: 0.4,
        height: 0.45,
        rotation: 0,
        zIndex: 0,
        text: null,
        image: { src: newImageSrc.trim(), crop: null },
      } as CanvasLayer),
    );
    setNewImageSrc("");
  };

  const num = (v: string) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      {/* Preview */}
      <div className="space-y-2">
        <div
          className="relative w-full overflow-hidden rounded-lg border bg-black"
          style={{ aspectRatio: `${dims.width} / ${dims.height}` }}
          aria-label="Thumbnail canvas preview"
        >
          {canvas.background.type === "image" && canvas.background.imageUrl ? (
            <img
              src={canvas.background.imageUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div
              className="absolute inset-0"
              style={{ backgroundColor: canvas.background.color }}
            />
          )}
          {sorted
            .slice()
            .reverse()
            .map((layer) => (
              <button
                key={layer.id}
                type="button"
                disabled={disabled}
                onClick={() => setSelectedId(layer.id)}
                className={`absolute overflow-hidden ${
                  layer.id === selectedId ? "outline outline-2 outline-primary" : ""
                }`}
                style={{
                  left: `${layer.x * 100}%`,
                  top: `${layer.y * 100}%`,
                  width: `${layer.width * 100}%`,
                  height: `${layer.height * 100}%`,
                  transform: `rotate(${layer.rotation}deg)`,
                }}
                aria-label={`Select layer ${layer.name}`}
              >
                {layer.kind === "text" && layer.text ? (
                  <span
                    className="flex h-full w-full items-center justify-center p-1 text-center font-black leading-tight"
                    style={{
                      color: layer.text.color,
                      fontSize: "clamp(8px, 4cqw, 48px)",
                      textShadow: "0 2px 8px rgba(0,0,0,0.85)",
                      textAlign: layer.text.align,
                    }}
                  >
                    {layer.text.content}
                  </span>
                ) : layer.kind === "image" && layer.image ? (
                  <img
                    src={layer.image.src}
                    alt={layer.name}
                    className="h-full w-full object-cover"
                  />
                ) : null}
              </button>
            ))}
          {canvas.layers.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="max-w-[70%] text-center text-sm text-white/60">
                Empty canvas — add a text or image layer to start designing.
              </p>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {dims.width}×{dims.height} · {canvas.layers.length} layer
          {canvas.layers.length === 1 ? "" : "s"}
        </p>

        {/* Background */}
        <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
          <div className="space-y-1">
            <Label>Background</Label>
            <div className="flex gap-2">
              <Input
                type="color"
                value={canvas.background.color}
                disabled={disabled}
                onChange={(e) =>
                  patch((s) =>
                    setBackground(s, { type: "color", color: e.target.value, imageUrl: null }),
                  )
                }
                className="h-9 w-12 cursor-pointer p-1"
                aria-label="Background color"
              />
              <Input
                value={bgImageUrl}
                disabled={disabled}
                onChange={(e) => setBgImageUrl(e.target.value)}
                placeholder="…or paste a background image URL"
                className="w-56"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={disabled || !bgImageUrl.trim()}
                onClick={() =>
                  patch((s) =>
                    setBackground(s, {
                      type: "image",
                      color: s.background.color,
                      imageUrl: bgImageUrl.trim(),
                    }),
                  )
                }
              >
                Use image
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Layers panel */}
      <div className="space-y-3">
        <div className="space-y-2 rounded-lg border p-3">
          <Label>Add layer</Label>
          <div className="flex gap-2">
            <Input
              value={newText}
              disabled={disabled}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="Headline text"
              maxLength={60}
            />
            <Button size="sm" disabled={disabled || !newText.trim()} onClick={addTextLayer}>
              <Type className="mr-1 h-3.5 w-3.5" /> Text
            </Button>
          </div>
          <div className="flex gap-2">
            <Input
              value={newImageSrc}
              disabled={disabled}
              onChange={(e) => setNewImageSrc(e.target.value)}
              placeholder="Image URL or storage path"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={disabled || !newImageSrc.trim()}
              onClick={addImageLayer}
            >
              <ImageIcon className="mr-1 h-3.5 w-3.5" /> Image
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Layers ({sorted.length})</Label>
          {sorted.length === 0 ? (
            <p className="text-sm text-muted-foreground">No layers yet.</p>
          ) : (
            sorted.map((l) => (
              <div
                key={l.id}
                className={`flex items-center gap-1.5 rounded-md border p-1.5 ${
                  l.id === selectedId ? "border-primary" : "border-border"
                }`}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  onClick={() => setSelectedId(l.id === selectedId ? null : l.id)}
                >
                  {l.kind === "text" ? (
                    <Type className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate text-sm">{l.name}</span>
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  disabled={disabled}
                  onClick={() => patch((s) => bringForward(s, l.id))}
                  aria-label="Bring forward"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  disabled={disabled}
                  onClick={() => patch((s) => sendBackward(s, l.id))}
                  aria-label="Send backward"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  disabled={disabled}
                  onClick={() => {
                    patch((s) => removeLayer(s, l.id));
                    if (selectedId === l.id) setSelectedId(null);
                  }}
                  aria-label={`Delete layer ${l.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))
          )}
        </div>

        {selected && (
          <div className="space-y-2.5 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <Label>Selected layer</Label>
              <Button size="sm" variant="ghost" onClick={() => setSelectedId(null)}>
                Deselect
              </Button>
            </div>
            <div className="space-y-1">
              <Label>Name</Label>
              <Input
                value={selected.name}
                disabled={disabled}
                maxLength={80}
                onChange={(e) =>
                  patch((s) => ({
                    ...s,
                    layers: s.layers.map((l) =>
                      l.id === selected.id ? { ...l, name: e.target.value } : l,
                    ),
                  }))
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>X %</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  disabled={disabled}
                  value={Math.round(selected.x * 100)}
                  onChange={(e) =>
                    patch((s) => moveLayer(s, selected.id, num(e.target.value) / 100, selected.y))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Y %</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  disabled={disabled}
                  value={Math.round(selected.y * 100)}
                  onChange={(e) =>
                    patch((s) => moveLayer(s, selected.id, selected.x, num(e.target.value) / 100))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Width %</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  disabled={disabled}
                  value={Math.round(selected.width * 100)}
                  onChange={(e) =>
                    patch((s) =>
                      resizeLayer(s, selected.id, num(e.target.value) / 100, selected.height),
                    )
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Height %</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  disabled={disabled}
                  value={Math.round(selected.height * 100)}
                  onChange={(e) =>
                    patch((s) =>
                      resizeLayer(s, selected.id, selected.width, num(e.target.value) / 100),
                    )
                  }
                />
              </div>
            </div>
            {selected.kind === "text" && selected.text && (
              <div className="space-y-2">
                <div className="space-y-1">
                  <Label>Text</Label>
                  <Input
                    value={selected.text.content}
                    disabled={disabled}
                    maxLength={60}
                    onChange={(e) =>
                      patch((s) => ({
                        ...s,
                        layers: s.layers.map((l) =>
                          l.id === selected.id && l.text
                            ? { ...l, text: { ...l.text, content: e.target.value } }
                            : l,
                        ),
                      }))
                    }
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label>Font</Label>
                    <Select
                      value={selected.text.font}
                      disabled={disabled}
                      onValueChange={(v) =>
                        patch((s) => ({
                          ...s,
                          layers: s.layers.map((l) =>
                            l.id === selected.id && l.text
                              ? { ...l, text: { ...l.text, font: v as (typeof FONTS)[number] } }
                              : l,
                          ),
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FONTS.map((f) => (
                          <SelectItem key={f} value={f}>
                            {FONT_LABEL[f]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Color</Label>
                    <Input
                      type="color"
                      value={selected.text.color}
                      disabled={disabled}
                      className="h-10 w-full cursor-pointer p-1"
                      onChange={(e) =>
                        patch((s) => ({
                          ...s,
                          layers: s.layers.map((l) =>
                            l.id === selected.id && l.text
                              ? { ...l, text: { ...l.text, color: e.target.value } }
                              : l,
                          ),
                        }))
                      }
                    />
                  </div>
                </div>
              </div>
            )}
            {selected.kind === "image" && selected.image && (
              <div className="space-y-1">
                <Label>Image source</Label>
                <Input
                  value={selected.image.src}
                  disabled={disabled}
                  onChange={(e) =>
                    patch((s) => ({
                      ...s,
                      layers: s.layers.map((l) =>
                        l.id === selected.id && l.image
                          ? { ...l, image: { ...l.image, src: e.target.value } }
                          : l,
                      ),
                    }))
                  }
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Small helper for the "add layer" affordance when the panel is empty. */
export function AddLayerHint() {
  return (
    <p className="flex items-center gap-1 text-xs text-muted-foreground">
      <Plus className="h-3 w-3" /> Add text or image layers above, then save the canvas.
    </p>
  );
}
