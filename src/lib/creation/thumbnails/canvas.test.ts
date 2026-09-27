/**
 * F15 — unit tests for the layered canvas model (pure ops, no I/O).
 */
import { describe, expect, it } from "vitest";
import {
  addLayer,
  bringForward,
  emptyCanvas,
  moveLayer,
  removeLayer,
  resizeLayer,
  sendBackward,
  setBackground,
  validateCanvasState,
  type CanvasLayer,
} from "./canvas";

function textLayer(overrides: Partial<CanvasLayer> = {}): CanvasLayer {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    kind: "text",
    name: "Headline",
    x: 0.1,
    y: 0.7,
    width: 0.8,
    height: 0.2,
    rotation: 0,
    zIndex: 0,
    text: { content: "WHY?", font: "bold-sans", color: "#FFFFFF", align: "center" },
    image: null,
    ...overrides,
  };
}

function imageLayer(overrides: Partial<CanvasLayer> = {}): CanvasLayer {
  return {
    id: "00000000-0000-4000-8000-000000000002",
    kind: "image",
    name: "Face",
    x: 0.55,
    y: 0.1,
    width: 0.4,
    height: 0.5,
    rotation: 0,
    zIndex: 0,
    text: null,
    image: { src: "faces/shot-1.jpg", crop: null },
    ...overrides,
  };
}

describe("addLayer", () => {
  it("appends on top of the stack with incrementing zIndex", () => {
    let s = addLayer(emptyCanvas(), textLayer());
    s = addLayer(s, imageLayer());
    expect(s.layers).toHaveLength(2);
    expect(s.layers[0]!.zIndex).toBe(0);
    expect(s.layers[1]!.zIndex).toBe(1);
  });
  it("rejects duplicate ids and invalid layers (no-op)", () => {
    const s = addLayer(emptyCanvas(), textLayer());
    expect(addLayer(s, textLayer())).toBe(s);
    expect(addLayer(s, { ...textLayer(), id: "not-a-uuid" })).toBe(s);
  });
  it("caps the layer count at 24", () => {
    let s = emptyCanvas();
    for (let i = 0; i < 30; i++) {
      s = addLayer(
        s,
        textLayer({ id: `00000000-0000-4000-8000-00000000${String(i + 10).padStart(4, "0")}` }),
      );
    }
    expect(s.layers).toHaveLength(24);
  });
});

describe("moveLayer / resizeLayer", () => {
  it("moves and clamps coordinates to 0..1", () => {
    const s = moveLayer(addLayer(emptyCanvas(), textLayer()), textLayer().id, 2, -1);
    const l = s.layers[0]!;
    expect(l.x).toBe(1);
    expect(l.y).toBe(0);
  });
  it("resizes and clamps dims to 0.01..1", () => {
    const s = resizeLayer(addLayer(emptyCanvas(), textLayer()), textLayer().id, 5, 0);
    const l = s.layers[0]!;
    expect(l.width).toBe(1);
    expect(l.height).toBe(0.01);
  });
  it("is a no-op for unknown ids and non-finite numbers", () => {
    const s = addLayer(emptyCanvas(), textLayer());
    expect(moveLayer(s, "nope", 0.5, 0.5)).toBe(s);
    expect(resizeLayer(s, textLayer().id, NaN, 0.5)).toBe(s);
  });
});

describe("removeLayer / bringForward / sendBackward", () => {
  it("removes by id", () => {
    const s = removeLayer(addLayer(emptyCanvas(), textLayer()), textLayer().id);
    expect(s.layers).toHaveLength(0);
  });
  it("reorders zIndex without disturbing others", () => {
    const third = textLayer({ id: "00000000-0000-4000-8000-000000000003" });
    let s = addLayer(addLayer(addLayer(emptyCanvas(), textLayer()), imageLayer()), third);
    s = sendBackward(s, third.id); // 2 -> 1
    const zs = new Map(s.layers.map((l) => [l.id, l.zIndex]));
    expect(zs.get(third.id)).toBe(1);
    expect(zs.get(imageLayer().id)).toBe(2);
    s = bringForward(s, third.id); // 1 -> 2
    expect(new Map(s.layers.map((l) => [l.id, l.zIndex])).get(third.id)).toBe(2);
  });
  it("is a no-op at the top/bottom of the stack", () => {
    const s = addLayer(emptyCanvas(), textLayer());
    expect(bringForward(s, textLayer().id)).toBe(s);
    expect(sendBackward(s, textLayer().id)).toBe(s);
  });
});

describe("setBackground", () => {
  it("replaces a valid background", () => {
    const s = setBackground(emptyCanvas(), {
      type: "color",
      color: "#FF0000",
      imageUrl: null,
    });
    expect(s.background.color).toBe("#FF0000");
  });
  it("rejects image backgrounds without a URL and invalid colors", () => {
    const s = emptyCanvas();
    expect(setBackground(s, { type: "image", color: "#0B0B0F", imageUrl: null })).toBe(s);
    expect(setBackground(s, { type: "color", color: "red", imageUrl: null })).toBe(s);
  });
});

describe("validateCanvasState", () => {
  it("accepts a well-formed canvas", () => {
    const s = addLayer(addLayer(emptyCanvas(), textLayer()), imageLayer());
    expect(validateCanvasState(s)).toEqual([]);
  });
  it("reports structural problems on unknown input", () => {
    expect(validateCanvasState(null)).not.toEqual([]);
    expect(validateCanvasState({ layers: "nope" })).not.toEqual([]);
  });
  it("flags text layers without a text spec", () => {
    const raw = {
      layers: [{ ...textLayer(), text: null }],
      background: { type: "color", color: "#0B0B0F", imageUrl: null },
    };
    expect(validateCanvasState(raw)).toContain(
      `layer ${textLayer().id}: text layer has no text spec`,
    );
  });
});
