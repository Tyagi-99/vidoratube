/**
 * Shared render geometry + caption utilities.
 *
 * Used by the server FFmpeg worker (worker/) and safe to import from browser
 * code — no Node APIs, no secrets.
 */

export type AspectId = "16:9" | "9:16" | "1:1";

export const ASPECT_DIMENSIONS: Record<AspectId, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
};

export function parseAspect(aspect: string): AspectId {
  if (aspect === "9:16" || aspect === "1:1") return aspect;
  return "16:9";
}

export function dimensionsFor(aspect: string): { width: number; height: number } {
  return ASPECT_DIMENSIONS[parseAspect(aspect)];
}

/**
 * FFmpeg scale/crop filter that fills the target frame from any input:
 * center-cropped "cover" fit, then exact dimensions. Handles odd sizes via
 * the `ceil(.../2)*2` guard FFmpeg needs for yuv420p.
 */
export function coverFilter(aspect: string): string {
  const { width, height } = dimensionsFor(aspect);
  // scale to cover, then center-crop to exact size
  return (
    `scale=${width}:${height}:force_original_aspect_ratio=increase,` +
    `crop=${width}:${height},setsar=1`
  );
}

/** Word-level caption cue. */
export type WordCue = {
  /** seconds */
  start: number;
  /** seconds */
  end: number;
  word: string;
};

function assTimestamp(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s % 1) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function escapeAss(text: string): string {
  return text.replace(/\{/g, "(").replace(/\}/g, ")").replace(/\n/g, " ");
}

/**
 * Build an ASS subtitle file with karaoke-style per-word highlighting.
 *
 * Words are grouped into lines of up to `wordsPerLine`; each word gets its
 * own karaoke timing tag so the current word highlights as it's spoken.
 * Colors: white base, yellow highlight — readable on darkened video.
 */
export function buildWordAss(
  cues: WordCue[],
  opts: { wordsPerLine?: number; fontSize?: number } = {},
): string {
  const wordsPerLine = Math.max(1, opts.wordsPerLine ?? 4);
  const fontSize = opts.fontSize ?? 64;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Vidora,Inter,${fontSize},&H00FFFFFF,&H0000FFFF,&H80000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,5,40,40,80,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const lines: string[] = [];
  for (let i = 0; i < cues.length; i += wordsPerLine) {
    const group = cues.slice(i, i + wordsPerLine);
    if (group.length === 0) continue;
    const start = assTimestamp(group[0]!.start);
    const end = assTimestamp(group[group.length - 1]!.end);
    // Karaoke: each word's tag duration is in centiseconds.
    const text = group
      .map((c) => {
        const cs = Math.max(1, Math.round((c.end - c.start) * 100));
        return `{\\kf${cs}}${escapeAss(c.word)}`;
      })
      .join(" ");
    lines.push(`Dialogue: 0,${start},${end},Vidora,,0,0,0,,${text}`);
  }

  return header + lines.join("\n") + "\n";
}

/**
 * Split plain narration text into word cues spread evenly across a duration.
 * Used when precise TTS word timings aren't available.
 */
export function spreadWords(text: string, start: number, duration: number): WordCue[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0 || duration <= 0) return [];
  const per = duration / words.length;
  return words.map((word, i) => ({
    word,
    start: start + i * per,
    end: start + (i + 1) * per,
  }));
}

export type SceneInput = {
  id: string;
  number: number;
  narration: string;
  /** Local path or URL to the scene image */
  image: string | null;
  /** Local path or URL to the scene audio (narration) */
  audio: string | null;
  duration: number;
  cues: WordCue[];
};

/** Total timeline duration for a list of scenes. */
export function timelineDuration(scenes: SceneInput[]): number {
  return scenes.reduce((sum, s) => sum + Math.max(0, s.duration), 0);
}
