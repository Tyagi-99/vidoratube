/**
 * F15 — layered thumbnail canvas model (pure functions, no I/O).
 *
 * The canvas is the design surface persisted on `thumbnail_projects.canvas`
 * ({ layers, background }). All coordinates are RELATIVE (0..1) to the canvas
 * frame so one project can be re-framed between 16:9 and 9:16 without
 * re-authoring. Variant RENDERS live in `public.thumbnails` — this module
 * never touches that table.
 */
import { z } from "zod";

/* ── Schema ─────────────────────────────────────────────────────────────── */

export const CanvasAspectSchema = z.enum(["16:9", "9:16"]);
export type CanvasAspect = z.infer<typeof CanvasAspectSchema>;

/** Pixel dims for each aspect (YouTube thumbnail guidance). */
export const CANVAS_DIMS: Record<CanvasAspect, { width: number; height: number }> = {
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
};

export const CanvasLayerKindSchema = z.enum(["text", "image"]);
export type CanvasLayerKind = z.infer<typeof CanvasLayerKindSchema>;

export const CanvasLayerSchema = z.object({
  id: z.string().uuid(),
  kind: CanvasLayerKindSchema,
  /** Label for the layer list (e.g. "Headline", "Face crop"). */
  name: z.string().trim().min(1).max(80).default("Layer"),
  /** Relative position of the layer's top-left corner: 0..1. */
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  /** Relative size: 0..1 of the canvas frame. */
  width: z.number().min(0.01).max(1),
  height: z.number().min(0.01).max(1),
  /** Rotation in degrees (-180..180). */
  rotation: z.number().min(-180).max(180).default(0),
  /** Paint order; higher renders on top. */
  zIndex: z.number().int().min(0),
  // text layers
  text: z
    .object({
      content: z.string().trim().min(1).max(60),
      font: z.enum(["bold-sans", "condensed", "serif-display", "mono"]).default("bold-sans"),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      align: z.enum(["left", "center", "right"]).default("center"),
    })
    .nullable()
    .default(null),
  // image layers
  image: z
    .object({
      /** Storage path or public URL of the layer image. */
      src: z.string().trim().min(1).max(2000),
      /** Optional crop rect (relative 0..1 of the source image). */
      crop: z
        .object({
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
          width: z.number().min(0.01).max(1),
          height: z.number().min(0.01).max(1),
        })
        .nullable()
        .default(null),
    })
    .nullable()
    .default(null),
});
export type CanvasLayer = z.infer<typeof CanvasLayerSchema>;

export const CanvasBackgroundSchema = z.object({
  type: z.enum(["color", "image"]).default("color"),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#0B0B0F"),
  /** Required when type === "image". */
  imageUrl: z.string().trim().max(2000).nullable().default(null),
});
export type CanvasBackground = z.infer<typeof CanvasBackgroundSchema>;

export const CanvasStateSchema = z.object({
  layers: z.array(CanvasLayerSchema).max(24),
  background: CanvasBackgroundSchema,
});
export type CanvasState = z.infer<typeof CanvasStateSchema>;

/* ── Constructors ───────────────────────────────────────────────────────── */

export function emptyCanvas(): CanvasState {
  return { layers: [], background: { type: "color", color: "#0B0B0F", imageUrl: null } };
}

/* ── Pure ops (immutable; never throw — invalid input is a no-op returning
        the state unchanged, so the editor can never corrupt a project) ──── */

function findIndex(state: CanvasState, id: string): number {
  return state.layers.findIndex((l) => l.id === id);
}

/** Insert a new layer on top of the current stack. */
export function addLayer(state: CanvasState, layer: CanvasLayer): CanvasState {
  const parsed = CanvasLayerSchema.safeParse(layer);
  if (!parsed.success) return state;
  if (state.layers.some((l) => l.id === parsed.data.id)) return state;
  if (state.layers.length >= 24) return state;
  const zIndex = state.layers.length === 0 ? 0 : Math.max(...state.layers.map((l) => l.zIndex)) + 1;
  return { ...state, layers: [...state.layers, { ...parsed.data, zIndex }] };
}

/** Move a layer's top-left corner; coordinates are clamped to 0..1. */
export function moveLayer(state: CanvasState, id: string, x: number, y: number): CanvasState {
  const i = findIndex(state, id);
  if (i < 0 || !Number.isFinite(x) || !Number.isFinite(y)) return state;
  const layers = state.layers.map((l, idx) =>
    idx === i ? { ...l, x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) } : l,
  );
  return { ...state, layers };
}

/** Resize a layer; dims clamped to 0.01..1 and never NaN. */
export function resizeLayer(
  state: CanvasState,
  id: string,
  width: number,
  height: number,
): CanvasState {
  const i = findIndex(state, id);
  if (i < 0 || !Number.isFinite(width) || !Number.isFinite(height)) return state;
  const layers = state.layers.map((l, idx) =>
    idx === i
      ? {
          ...l,
          width: Math.min(1, Math.max(0.01, width)),
          height: Math.min(1, Math.max(0.01, height)),
        }
      : l,
  );
  return { ...state, layers };
}

/** Remove a layer by id. */
export function removeLayer(state: CanvasState, id: string): CanvasState {
  return { ...state, layers: state.layers.filter((l) => l.id !== id) };
}

/** Raise a layer one step in paint order (swap zIndex with the layer above). */
export function bringForward(state: CanvasState, id: string): CanvasState {
  const i = findIndex(state, id);
  if (i < 0) return state;
  const sorted = [...state.layers].sort((a, b) => a.zIndex - b.zIndex);
  const pos = sorted.findIndex((l) => l.id === id);
  if (pos < 0 || pos === sorted.length - 1) return state;
  const next = sorted[pos + 1]!;
  const zA = sorted[pos]!.zIndex;
  return {
    ...state,
    layers: state.layers.map((l) =>
      l.id === id ? { ...l, zIndex: next.zIndex } : l.id === next.id ? { ...l, zIndex: zA } : l,
    ),
  };
}

/** Lower a layer one step in paint order. */
export function sendBackward(state: CanvasState, id: string): CanvasState {
  const i = findIndex(state, id);
  if (i < 0) return state;
  const sorted = [...state.layers].sort((a, b) => a.zIndex - b.zIndex);
  const pos = sorted.findIndex((l) => l.id === id);
  if (pos <= 0) return state;
  const prev = sorted[pos - 1]!;
  const zA = sorted[pos]!.zIndex;
  return {
    ...state,
    layers: state.layers.map((l) =>
      l.id === id ? { ...l, zIndex: prev.zIndex } : l.id === prev.id ? { ...l, zIndex: zA } : l,
    ),
  };
}

/** Replace the canvas background (validated; invalid input is a no-op). */
export function setBackground(state: CanvasState, background: CanvasBackground): CanvasState {
  const parsed = CanvasBackgroundSchema.safeParse(background);
  if (!parsed.success) return state;
  if (parsed.data.type === "image" && !parsed.data.imageUrl) return state;
  return { ...state, background: parsed.data };
}

/* ── Validation ─────────────────────────────────────────────────────────── */

/**
 * Structural validation of a canvas state loaded from `thumbnail_projects.canvas`.
 * Returns human-readable problems; empty array = valid.
 */
export function validateCanvasState(value: unknown): string[] {
  const problems: string[] = [];
  const parsed = CanvasStateSchema.safeParse(value);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  }
  const ids = new Set<string>();
  for (const layer of parsed.data.layers) {
    if (ids.has(layer.id)) problems.push(`layer ${layer.id}: duplicate id`);
    ids.add(layer.id);
    if (layer.kind === "text" && !layer.text)
      problems.push(`layer ${layer.id}: text layer has no text spec`);
    if (layer.kind === "image" && !layer.image)
      problems.push(`layer ${layer.id}: image layer has no image spec`);
  }
  return problems;
}
