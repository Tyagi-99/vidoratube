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

import type { CaptionLanguage } from "../languages";
import { primaryFontName } from "../languages";

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

function splitChars(word: string, maxChars: number): string[] {
  const chars = [...word];
  if (chars.length <= maxChars) return [word];
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += maxChars) {
    out.push(chars.slice(i, i + maxChars).join(""));
  }
  return out;
}

type LineChunk = { text: string; cs: number };
type CaptionLine = { chunks: LineChunk[]; start: number; end: number };

/**
 * Group cues into caption lines by character budget (from the language's
 * caption_max_chars). Words longer than the budget are split by character —
 * this is what makes CJK scripts (no whitespace) wrap correctly.
 * Karaoke durations are prorated across the chunks of a word.
 */
function groupCuesByChars(cues: WordCue[], maxChars: number): CaptionLine[] {
  const lines: CaptionLine[] = [];
  let chunks: LineChunk[] = [];
  let lineLen = 0;
  let lineStart = 0;
  let lineEnd = 0;
  const flush = () => {
    if (chunks.length > 0) {
      lines.push({ chunks, start: lineStart, end: lineEnd });
      chunks = [];
      lineLen = 0;
    }
  };
  for (const cue of cues) {
    const wordLen = Math.max(1, [...cue.word].length);
    for (const part of splitChars(cue.word, maxChars)) {
      const partLen = [...part].length;
      const cs = Math.max(
        1,
        Math.round(((cue.end - cue.start) * partLen * 100) / wordLen),
      );
      if (chunks.length > 0 && lineLen + 1 + partLen > maxChars) flush();
      if (chunks.length === 0) lineStart = cue.start;
      lineEnd = cue.end;
      chunks.push({ text: part, cs });
      lineLen = chunks.length === 1 ? partLen : lineLen + 1 + partLen;
    }
  }
  flush();
  return lines;
}

/** Legacy grouping: fixed number of words per line (no language given). */
function groupCuesByWords(cues: WordCue[], wordsPerLine: number): CaptionLine[] {
  const lines: CaptionLine[] = [];
  for (let i = 0; i < cues.length; i += wordsPerLine) {
    const group = cues.slice(i, i + wordsPerLine);
    if (group.length === 0) continue;
    lines.push({
      chunks: group.map((c) => ({
        text: c.word,
        cs: Math.max(1, Math.round((c.end - c.start) * 100)),
      })),
      start: group[0]!.start,
      end: group[group.length - 1]!.end,
    });
  }
  return lines;
}

/**
 * Build an ASS subtitle file with karaoke-style per-word highlighting.
 *
 * Words are grouped into lines of up to `wordsPerLine`; each word gets its
 * own karaoke timing tag so the current word highlights as it's spoken.
 * Colors: white base, yellow highlight — readable on darkened video.
 *
 * Pass `language` (from the `languages` table) for language-aware captions:
 * the style's Fontname comes from the language's font_stack, lines wrap at
 * the language's caption_max_chars, and RTL languages are marked so the
 * burn-in layer applies right-to-left direction. Text is always kept in
 * logical (reading) order — libass applies the Unicode bidi algorithm.
 */
export function buildWordAss(
  cues: WordCue[],
  opts: { wordsPerLine?: number; fontSize?: number; language?: CaptionLanguage } = {},
): string {
  const fontSize = opts.fontSize ?? 64;
  const fontName = opts.language
    ? primaryFontName(opts.language.fontStack)
    : "Inter";
  const directionComment = opts.language?.rtl ? "; Direction: RTL\n" : "";

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
ScaledBorderAndShadow: yes
${directionComment}
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Vidora,${fontName},${fontSize},&H00FFFFFF,&H0000FFFF,&H80000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,5,40,40,80,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const lines = opts.language
    ? groupCuesByChars(cues, Math.max(1, opts.language.captionMaxChars))
    : groupCuesByWords(cues, Math.max(1, opts.wordsPerLine ?? 4));

  const dialogue = lines.map((line) => {
    const text = line.chunks
      .map((c) => `{\\kf${c.cs}}${escapeAss(c.text)}`)
      .join(" ");
    return `Dialogue: 0,${assTimestamp(line.start)},${assTimestamp(line.end)},Vidora,,0,0,0,,${text}`;
  });

  return header + dialogue.join("\n") + "\n";
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
