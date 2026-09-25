/**
 * Story Mode narrative template — worker mirror.
 *
 * Dependency-free duplicate of the subset of src/lib/story-template.ts the
 * worker pipeline needs (beats, assignment, duck profile, music envelope,
 * caption emphasis). Keep in sync with the canonical file.
 */

export type StoryBeatId = "hook" | "setup" | "rising_tension" | "payoff" | "loop_cta";

export interface StoryBeat {
  id: StoryBeatId;
  share: number;
  parallax: number;
  captionEmphasis: boolean;
  musicLevel: number;
}

export const STORY_BEATS: readonly StoryBeat[] = [
  { id: "hook", share: 0.08, parallax: 0.6, captionEmphasis: true, musicLevel: 0.7 },
  { id: "setup", share: 0.2, parallax: 0.7, captionEmphasis: false, musicLevel: 1.0 },
  { id: "rising_tension", share: 0.42, parallax: 1.0, captionEmphasis: false, musicLevel: 1.3 },
  { id: "payoff", share: 0.2, parallax: 0.8, captionEmphasis: true, musicLevel: 1.1 },
  { id: "loop_cta", share: 0.1, parallax: 0.4, captionEmphasis: false, musicLevel: 0.9 },
];

function beatById(id: StoryBeatId): StoryBeat {
  return STORY_BEATS.find((b) => b.id === id)!;
}

export function assignStoryBeats(durations: number[]): StoryBeatId[] {
  const total = durations.reduce((a, d) => a + Math.max(0, d), 0);
  if (durations.length === 0 || total <= 0) return [];
  // Cumulative beat windows.
  const windows: { beat: StoryBeatId; end: number }[] = [];
  let acc = 0;
  STORY_BEATS.forEach((b, i) => {
    acc += b.share * total;
    windows.push({ beat: b.id, end: i === STORY_BEATS.length - 1 ? total : acc });
  });
  let t = 0;
  return durations.map((d) => {
    const mid = t + Math.max(0, d) / 2;
    t += Math.max(0, d);
    return (windows.find((w) => mid < w.end) ?? windows[windows.length - 1]!).beat;
  });
}

export function storyParallaxMultiplier(beat: StoryBeatId): number {
  return beatById(beat).parallax;
}

export function storyCaptionEmphasis(beat: StoryBeatId): boolean {
  return beatById(beat).captionEmphasis;
}

export const STORY_DUCK_PROFILE = {
  threshold: 0.02,
  ratio: 10,
  attack: 20,
  release: 600,
} as const;

export function storyDuckParams(): string {
  const d = STORY_DUCK_PROFILE;
  return `threshold=${d.threshold}:ratio=${d.ratio}:attack=${d.attack}:release=${d.release}`;
}

export function storyMusicSegments(durations: number[]): { end: number; level: number }[] {
  const beats = assignStoryBeats(durations);
  const out: { end: number; level: number }[] = [];
  let t = 0;
  for (let i = 0; i < durations.length; i++) {
    t += Math.max(0, durations[i]!);
    const level = beatById(beats[i]!).musicLevel;
    const last = out[out.length - 1];
    if (last && last.level === level) {
      last.end = t;
    } else {
      out.push({ end: t, level });
    }
  }
  return out;
}

export function storyMusicVolumeExpr(
  segments: { end: number; level: number }[],
  baseVolume: number,
): string {
  if (segments.length === 0) return `${baseVolume}`;
  let expr = segments[segments.length - 1]!.level.toFixed(3);
  for (let i = segments.length - 2; i >= 0; i--) {
    const s = segments[i]!;
    expr = `if(lt(t,${s.end.toFixed(2)}),${s.level.toFixed(3)},${expr})`;
  }
  return `${baseVolume}*(${expr})`;
}
