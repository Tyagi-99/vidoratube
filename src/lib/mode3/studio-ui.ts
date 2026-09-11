export const AUTO_EDIT_CAPTION_STYLES = [
  { id: "highlight", label: "Highlight" },
  { id: "karaoke", label: "Karaoke" },
  { id: "box", label: "Box" },
] as const;

export type AutoEditCaptionStyleId = (typeof AUTO_EDIT_CAPTION_STYLES)[number]["id"];

export type VoiceoverMode = "off" | "generate" | "upload";

export function formatEditorClock(seconds: number): string {
  const n = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
  const m = Math.floor(n / 60);
  const s = n % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function voiceoverFlags(mode: VoiceoverMode): {
  enable_voiceover: boolean;
  mute_original: boolean;
} {
  if (mode === "generate") return { enable_voiceover: true, mute_original: true };
  return { enable_voiceover: false, mute_original: false };
}
