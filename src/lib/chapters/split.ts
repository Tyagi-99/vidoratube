/**
 * Sprint 3-4: deterministic script → chapter splitting for long-form renders.
 *
 * Pure functions (no I/O) so the split is unit-testable and identical on
 * every run: the same script always yields the same chapters.
 *
 * Language-neutral by design:
 * - Paragraph boundaries are blank lines — a convention of the script
 *   format, not of any language.
 * - Hard section boundaries are `## ` markdown headings — again format,
 *   not language.
 * - Duration is estimated from whitespace-separated token counts. This is
 *   only an estimate used to balance chapter lengths; the worker measures
 *   real audio durations with ffprobe, so scripts without whitespace
 *   (e.g. CJK) still render correctly — their chapters are just balanced
 *   less precisely. RTL text and long scripts are the caption layer's
 *   concern (ASS/Unicode bidi), not the splitter's.
 */

export const MIN_CHAPTERS = 4;
export const MAX_CHAPTERS = 8;
/** Target chapter length: 20 min / ~3 min per chapter ≈ 6-7 chapters. */
export const TARGET_CHAPTER_SECONDS = 180;
/** Narration pace used only for balancing (the worker uses real durations). */
export const ESTIMATED_WORDS_PER_MINUTE = 150;

export interface Chapter {
  /** 1-based. */
  index: number;
  title: string;
  /** The chapter's script: paragraphs joined by blank lines. */
  scriptText: string;
  paragraphs: string[];
  /** Balancing estimate in seconds (whitespace tokens / 150 wpm). */
  estimatedSeconds: number;
}

/** Split raw script text into paragraphs on blank lines. Never empty. */
export function splitIntoParagraphs(text: string): string[] {
  const paras = text
    .replace(/\r\n?/g, "\n")
    // A `## Heading` line is its own paragraph even without blank lines
    // around it, so it can act as a hard chapter boundary.
    .replace(/^(#{1,3}\s+[^\n]*)$/gm, "\n$1\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return paras.length > 0 ? paras : [text.trim()].filter((p) => p.length > 0);
}

/** Estimated narration seconds for a paragraph (balancing only). */
export function estimateParagraphSeconds(paragraph: string): number {
  const tokens = paragraph.split(/\s+/).filter(Boolean).length;
  if (tokens === 0) return 0;
  return Math.max(2, (tokens / ESTIMATED_WORDS_PER_MINUTE) * 60);
}

/** True when the paragraph is a `## Heading` section marker. */
export function isSectionHeading(paragraph: string): boolean {
  return /^#{1,3}\s+\S/.test(paragraph);
}

function headingTitle(paragraph: string): string {
  return paragraph.replace(/^#{1,3}\s+/, "").trim();
}

function fallbackTitle(firstParagraph: string): string {
  const noHeading = firstParagraph.replace(/^#{1,3}\s+/, "");
  // First sentence, or the first 60 chars when there is no sentence break.
  const m = noHeading.match(/^(.+?[.!?…\n])\s/);
  const t = (m?.[1] ?? noHeading).trim().replace(/\s+/g, " ");
  return t.length > 60 ? `${t.slice(0, 57).trimEnd()}…` : t;
}

/**
 * Split a script into 4–8 chapters of roughly equal estimated duration.
 *
 * Deterministic: paragraph boundaries, heading boundaries, and a greedy
 * fill toward `totalSeconds / n`. Chapter count:
 *   n = clamp(round(totalSeconds / TARGET_CHAPTER_SECONDS), 4, 8)
 * When `## ` headings already define more sections than MAX_CHAPTERS, the
 * smallest adjacent sections merge until the cap holds; headings never
 * create *fewer* chapters than the target count — the greedy fill still
 * splits long sections.
 */
export function splitScriptIntoChapters(
  scriptText: string,
  opts?: { targetChapterSeconds?: number },
): Chapter[] {
  const target = opts?.targetChapterSeconds ?? TARGET_CHAPTER_SECONDS;
  const raw = splitIntoParagraphs(scriptText);
  if (raw.length === 0) return [];

  // Group paragraphs into sections at hard heading boundaries. A heading
  // line belongs to the section it starts.
  const sections: string[][] = [];
  for (const p of raw) {
    if (isSectionHeading(p) && sections.length > 0) sections.push([p]);
    else if (sections.length === 0) sections.push([p]);
    else sections[sections.length - 1]!.push(p);
  }

  const sectionSecs = sections.map((s) =>
    s.reduce((a, p) => a + estimateParagraphSeconds(p), 0),
  );
  const totalSecs = sectionSecs.reduce((a, b) => a + b, 0);
  // Never more chapters than paragraphs (a chapter needs ≥1 paragraph).
  const n = Math.min(
    MAX_CHAPTERS,
    Math.max(MIN_CHAPTERS, Math.round(totalSecs / Math.max(1, target))),
    raw.length,
  );

  // Start from sections, then merge the smallest adjacent pair until we
  // are at most n groups.
  let groups: string[][] = sections.map((s) => [...s]);
  while (groups.length > n) {
    let best = 0;
    let bestSecs = Infinity;
    const secs = groups.map((g) =>
      g.reduce((a, p) => a + estimateParagraphSeconds(p), 0),
    );
    for (let i = 0; i < groups.length - 1; i++) {
      const s = secs[i]! + secs[i + 1]!;
      if (s < bestSecs) {
        bestSecs = s;
        best = i;
      }
    }
    groups.splice(best, 2, [...groups[best]!, ...groups[best + 1]!]);
  }

  // Cut the (merged) sections into exactly n chapters at the paragraph
  // boundaries closest to the ideal even split. Section starts are forced
  // cuts — a heading always opens its chapter.
  const flat: string[] = groups.flat();
  const paraSecs = flat.map(estimateParagraphSeconds);
  const forced = new Set<number>(); // paragraph index where a group starts
  {
    let idx = 0;
    for (const g of groups) {
      forced.add(idx);
      idx += g.length;
    }
  }
  const cumulative: number[] = [];
  {
    let acc = 0;
    for (const s of paraSecs) {
      acc += s;
      cumulative.push(acc);
    }
  }
  // Boundary b = "cut after paragraph b" (0-based). Valid: 0..P-2.
  const chosen = new Set<number>();
  for (const f of forced) if (f > 0) chosen.add(f - 1);
  for (let k = 1; k < n && chosen.size < n - 1; k++) {
    const ideal = (totalSecs * k) / n;
    let best = -1;
    let bestDiff = Infinity;
    for (let b = 0; b < flat.length - 1; b++) {
      if (chosen.has(b)) continue;
      // Never cut between a heading and its content — a heading must open
      // the chapter it belongs to. (Cuts before a heading are the forced
      // section boundaries, already chosen above.)
      if (isSectionHeading(flat[b]!)) continue;
      const diff = Math.abs(cumulative[b]! - ideal);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = b;
      }
    }
    if (best >= 0) chosen.add(best);
  }
  const cuts = [...chosen].sort((a, b) => a - b);

  const ranges: string[][] = [];
  let start = 0;
  for (const c of cuts) {
    ranges.push(flat.slice(start, c + 1));
    start = c + 1;
  }
  ranges.push(flat.slice(start));

  return ranges.map((paras, i) => {
    const first = paras[0] ?? "";
    return {
      index: i + 1,
      title: isSectionHeading(first) ? headingTitle(first) : fallbackTitle(first),
      scriptText: paras.join("\n\n"),
      paragraphs: paras,
      estimatedSeconds: paras.reduce((a, p) => a + estimateParagraphSeconds(p), 0),
    };
  });
}
