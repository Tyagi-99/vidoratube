/**
 * Client-safe configuration for the Vidora production pipeline.
 * No secrets, no server imports — shared by UI and server code.
 */

export type VideoMode = "stock" | "image" | "video";

export const MODES: { id: VideoMode; label: string; description: string; enabled: boolean }[] = [
  {
    id: "stock",
    label: "Stock Media",
    description:
      "Free stock photos and video from Pexels and Pixabay, combined with AI narration, captions and basic editing.",
    enabled: true,
  },
  {
    id: "image",
    label: "AI Image",
    description: "Every scene gets a purpose-written AI image in the style you pick.",
    enabled: true,
  },
  {
    id: "video",
    label: "Complete Video",
    description: "Fully animated AI video scenes from premium video providers.",
    enabled: false,
  },
];

export const VISUAL_TYPES = [
  "STOCK_VIDEO",
  "STOCK_IMAGE",
  "AI_IMAGE",
  "MAP",
  "GRAPHIC",
  "TEXT_ONLY",
] as const;
export type VisualType = (typeof VISUAL_TYPES)[number];

export type ImageStyle = {
  id: string;
  label: string;
  prompt: string;
};

export const IMAGE_STYLES: ImageStyle[] = [
  {
    id: "cinematic_realistic",
    label: "Cinematic Realistic",
    prompt: "photorealistic cinematic documentary still, filmic colour grading, shallow depth of field",
  },
  {
    id: "historical_painting",
    label: "Historical Painting",
    prompt: "classical oil painting, museum quality, visible brushwork, chiaroscuro lighting",
  },
  { id: "watercolor", label: "Watercolor", prompt: "soft watercolour illustration, paper texture, gentle washes" },
  {
    id: "vintage_illustration",
    label: "Vintage Illustration",
    prompt: "antique engraved book illustration, aged paper, fine ink hatching",
  },
  {
    id: "office_illustration",
    label: "MS Word / Office Illustration",
    prompt: "simple flat office clipart style educational diagram, plain background, primary colours",
  },
  {
    id: "paint_basic",
    label: "Paint / Basic Drawing",
    prompt: "simple hand-drawn computer paint drawing, thick strokes, naive style",
  },
  { id: "sticky_note", label: "Sticky Note", prompt: "sketchnote on sticky notes, marker pen, doodle icons" },
  { id: "whiteboard", label: "Whiteboard", prompt: "whiteboard marker drawing, clean white background, educational" },
  { id: "hand_sketch", label: "Hand-drawn Sketch", prompt: "rough pencil sketch, graphite shading, loose lines" },
  { id: "comic", label: "Comic", prompt: "graphic novel comic panel, bold inking, dramatic shading" },
  { id: "flat_illustration", label: "Flat Illustration", prompt: "modern flat vector illustration, clean shapes" },
  { id: "infographic", label: "Infographic", prompt: "clean infographic design, iconography, restrained palette" },
  { id: "vintage_poster", label: "Vintage Poster", prompt: "vintage lithograph poster art, limited palette, bold shapes" },
  { id: "paper_cutout", label: "Paper Cutout", prompt: "layered paper cutout art, soft drop shadows, craft texture" },
  { id: "cartoon_3d", label: "3D Cartoon", prompt: "stylised 3D render, soft global illumination, friendly shapes" },
  { id: "pixel_art", label: "Pixel Art", prompt: "retro 16-bit pixel art, limited palette, crisp pixels" },
  { id: "chalkboard", label: "Chalkboard", prompt: "chalk drawing on a dark green chalkboard, white and pastel chalk" },
  { id: "storybook", label: "Storybook", prompt: "warm children's history storybook illustration, textured gouache" },
];

export const PRESETS = {
  sleep: {
    label: "Sleep / Boring History",
    minScene: 15,
    maxScene: 30,
    transition: "crossfade",
    motion: "slow_zoom",
    captionStyle: "sleep",
    musicVolume: 0.06,
    voiceTone: "calm, slow, soothing, low energy, long flowing sentences",
  },
  documentary: {
    label: "Documentary",
    minScene: 8,
    maxScene: 18,
    transition: "crossfade",
    motion: "ken_burns",
    captionStyle: "documentary",
    musicVolume: 0.12,
    voiceTone: "measured cinematic documentary narration",
  },
  war_history: {
    label: "War / History",
    minScene: 8,
    maxScene: 16,
    transition: "dip_to_black",
    motion: "slow_pan",
    captionStyle: "documentary",
    musicVolume: 0.12,
    voiceTone: "authoritative historical narration with dates and places",
  },
} as const;

export type PresetId = keyof typeof PRESETS;

export const CAPTION_STYLES = ["sleep", "documentary", "dynamic"] as const;

export const ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;

export const DURATIONS = [1, 3, 5, 10, 15, 20, 30] as const;

export const LANGUAGES = ["English", "Hindi", "Spanish", "French", "German", "Portuguese"] as const;

export const ELEVENLABS_MODELS = [
  { id: "eleven_flash_v2_5", label: "Flash v2.5 (fast, cheapest)" },
  { id: "eleven_turbo_v2_5", label: "Turbo v2.5" },
  { id: "eleven_multilingual_v2", label: "Multilingual v2 (best quality)" },
] as const;

export function styleById(id: string | null | undefined): ImageStyle {
  return IMAGE_STYLES.find((s) => s.id === id) ?? IMAGE_STYLES[0]!;
}

export function presetById(id: string | null | undefined) {
  return PRESETS[(id as PresetId) ?? "documentary"] ?? PRESETS.documentary;
}

/** How many scenes each pipeline tick processes in parallel. */
export const VISUAL_BATCH = 6;
export const VOICE_BATCH = 3;
