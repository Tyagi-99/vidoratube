/**
 * P4 visual style presets — the curated "Studio v2" set.
 *
 * These are video/cinematic-focused presets (distinct from the illustration
 * styles in studio-config.ts, which remain available). Each preset carries:
 * - promptModifier: appended to the scene's image prompt
 * - captionStyle: suggested caption treatment
 * - previewGradient: CSS gradient for the picker swatch (a style *hint*,
 *   explicitly not a generated preview — see the "Style hint" label in UI)
 * - colorGrade: hint passed to the render pipeline
 */

export type StudioStyleId =
  | "cinematic"
  | "anime"
  | "photoreal"
  | "watercolor"
  | "cyberpunk"
  | "documentary"
  | "minimalist"
  | "render3d"
  | "vintage_film"
  | "neon_noir";

export interface StudioStyle {
  id: StudioStyleId;
  label: string;
  labelHi: string;
  promptModifier: string;
  captionStyle: "documentary" | "dynamic" | "sleep";
  previewGradient: string;
  colorGrade: string;
}

export const STUDIO_STYLES: StudioStyle[] = [
  {
    id: "cinematic",
    label: "Cinematic",
    labelHi: "सिनेमैटिक",
    promptModifier:
      "cinematic film still, dramatic lighting, shallow depth of field, filmic colour grading, 35mm",
    captionStyle: "documentary",
    previewGradient: "linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#e94560 100%)",
    colorGrade: "teal-orange blockbuster grade",
  },
  {
    id: "anime",
    label: "Anime",
    labelHi: "एनिमे",
    promptModifier:
      "anime key visual, cel shaded, vibrant colours, detailed background art, studio quality",
    captionStyle: "dynamic",
    previewGradient: "linear-gradient(135deg,#ff6b9d 0%,#c44dff 50%,#4d7cff 100%)",
    colorGrade: "saturated pop grade",
  },
  {
    id: "photoreal",
    label: "Photoreal",
    labelHi: "फोटोरियल",
    promptModifier:
      "ultra photorealistic photograph, natural light, 8k detail, true to life",
    captionStyle: "documentary",
    previewGradient: "linear-gradient(135deg,#3a3a3a 0%,#7a7a7a 50%,#d4d4d4 100%)",
    colorGrade: "neutral natural grade",
  },
  {
    id: "watercolor",
    label: "Watercolor",
    labelHi: "वॉटरकलर",
    promptModifier:
      "soft watercolour painting, paper texture, gentle washes, artistic",
    captionStyle: "sleep",
    previewGradient: "linear-gradient(135deg,#a8e6cf 0%,#88d8e8 50%,#ff8b94 100%)",
    colorGrade: "soft pastel grade",
  },
  {
    id: "cyberpunk",
    label: "Cyberpunk",
    labelHi: "साइबरपंक",
    promptModifier:
      "cyberpunk aesthetic, neon lights, rain-soaked streets, futuristic, high contrast",
    captionStyle: "dynamic",
    previewGradient: "linear-gradient(135deg,#0f0c29 0%,#ff00ff 50%,#00ffff 100%)",
    colorGrade: "neon magenta-cyan grade",
  },
  {
    id: "documentary",
    label: "Documentary",
    labelHi: "डॉक्यूमेंट्री",
    promptModifier:
      "documentary photography, candid, natural lighting, editorial realism",
    captionStyle: "documentary",
    previewGradient: "linear-gradient(135deg,#2c3e50 0%,#4a6741 50%,#8b9a6b 100%)",
    colorGrade: "earthy editorial grade",
  },
  {
    id: "minimalist",
    label: "Minimalist",
    labelHi: "मिनिमलिस्ट",
    promptModifier:
      "minimalist composition, lots of negative space, clean lines, muted palette",
    captionStyle: "sleep",
    previewGradient: "linear-gradient(135deg,#f5f5f5 0%,#e0e0e0 50%,#bdbdbd 100%)",
    colorGrade: "clean desaturated grade",
  },
  {
    id: "render3d",
    label: "3D Render",
    labelHi: "3D रेंडर",
    promptModifier:
      "stylised 3D render, soft global illumination, octane render, polished",
    captionStyle: "dynamic",
    previewGradient: "linear-gradient(135deg,#667eea 0%,#764ba2 50%,#f093fb 100%)",
    colorGrade: "glossy CGI grade",
  },
  {
    id: "vintage_film",
    label: "Vintage Film",
    labelHi: "विंटेज फिल्म",
    promptModifier:
      "vintage film photograph, film grain, faded colours, 1970s aesthetic, nostalgic",
    captionStyle: "documentary",
    previewGradient: "linear-gradient(135deg,#8b5a2b 0%,#d4a574 50%,#f5e6d3 100%)",
    colorGrade: "warm faded vintage grade",
  },
  {
    id: "neon_noir",
    label: "Neon Noir",
    labelHi: "नियॉन नॉयर",
    promptModifier:
      "neo-noir, moody neon-lit darkness, rain, cinematic shadows, mysterious",
    captionStyle: "dynamic",
    previewGradient: "linear-gradient(135deg,#000000 0%,#4a00e0 50%,#ff006e 100%)",
    colorGrade: "dark neon-noir grade",
  },
];

export function studioStyleById(id: string | null | undefined): StudioStyle {
  return STUDIO_STYLES.find((s) => s.id === id) ?? STUDIO_STYLES[0]!;
}

/**
 * Builds the full image prompt: base scene prompt + style modifier +
 * optional character token. Character reference ("featuring {name}, {desc}")
 * keeps the subject consistent across scenes.
 */
export function buildStyledPrompt(opts: {
  basePrompt: string;
  styleId?: string | null;
  characterName?: string | null;
  characterDescription?: string | null;
}): string {
  const style = studioStyleById(opts.styleId ?? undefined);
  const parts = [opts.basePrompt.trim(), style.promptModifier];
  if (opts.characterName) {
    const charRef = opts.characterDescription
      ? `featuring ${opts.characterName} (${opts.characterDescription})`
      : `featuring ${opts.characterName}`;
    parts.push(charRef);
  }
  return parts.filter(Boolean).join(", ");
}
