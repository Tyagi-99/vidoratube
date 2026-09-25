import { describe, expect, it } from "vitest";
import { STUDIO_STYLES, buildStyledPrompt, studioStyleById } from "./styles";

describe("studio styles", () => {
  it("has exactly the 10 P4 presets", () => {
    expect(STUDIO_STYLES).toHaveLength(10);
    const ids = STUDIO_STYLES.map((s) => s.id);
    expect(ids).toEqual([
      "cinematic",
      "anime",
      "photoreal",
      "watercolor",
      "cyberpunk",
      "documentary",
      "minimalist",
      "render3d",
      "vintage_film",
      "neon_noir",
    ]);
  });

  it("every preset has prompt modifier, caption style, gradient, Hindi label", () => {
    for (const s of STUDIO_STYLES) {
      expect(s.promptModifier.length).toBeGreaterThan(10);
      expect(["documentary", "dynamic", "sleep"]).toContain(s.captionStyle);
      expect(s.previewGradient).toMatch(/^linear-gradient/);
      expect(s.labelHi.length).toBeGreaterThan(0);
    }
  });

  it("falls back to cinematic for unknown ids", () => {
    expect(studioStyleById("nope").id).toBe("cinematic");
    expect(studioStyleById(null).id).toBe("cinematic");
    expect(studioStyleById(undefined).id).toBe("cinematic");
  });

  it("buildStyledPrompt appends the style modifier", () => {
    const out = buildStyledPrompt({ basePrompt: "a mountain at dawn", styleId: "anime" });
    expect(out).toContain("a mountain at dawn");
    expect(out).toContain("anime key visual");
  });

  it("buildStyledPrompt adds the character token when given", () => {
    const out = buildStyledPrompt({
      basePrompt: "a detective in an office",
      styleId: "neon_noir",
      characterName: "Aarav",
      characterDescription: "young Indian detective, sharp jawline",
    });
    expect(out).toContain("featuring Aarav (young Indian detective, sharp jawline)");
    expect(out).toContain("neo-noir");
  });

  it("buildStyledPrompt works without character", () => {
    const out = buildStyledPrompt({ basePrompt: "a beach", styleId: "photoreal" });
    expect(out).not.toContain("featuring");
    expect(out).toContain("ultra photorealistic");
  });
});
