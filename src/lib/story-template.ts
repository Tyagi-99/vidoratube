/**
 * Story Mode narrative template (Sprint 3-4).
 *
 * Story Mode is a first-class creation mode: a five-beat narrative structure
 * (hook -> setup -> rising tension -> payoff -> loop/CTA) that shapes
 *   1. script structure — the narration plan prompt follows the beats,
 *   2. scene pacing — each scene is assigned a beat; the beat picks the
 *      motion treatment (browser) or the parallax intensity (2.5D on),
 *   3. caption styling — hook/payoff beats get the emphasis caption style,
 *   4. music ducking profile — a story-tuned sidechain profile plus a
 *      per-beat music volume envelope so the bed breathes with the story.
 *
 * Billing: Story Mode renders at the standard story multiplier (1.0) — the
 * template itself is free. 2.5D parallax is the paid add-on (+0.25/min).
 *
 * Language-neutral by design: no beat branches on a language name or code;
 * the guidance prose names no languages.
 */

export type StoryBeatId = "hook" | "setup" | "rising_tension" | "payoff" | "loop_cta";

export interface StoryBeat {
  id: StoryBeatId;
  label: string;
  /** Share of total runtime. All shares sum to 1. */
  share: number;
  /** What this beat does in the story. */
  description: string;
  /** Browser motion type for scenes on this beat (non-parallax path). */
  motion: "slow_zoom" | "slow_pan" | "ken_burns" | "zoom_out" | "none";
  /** Parallax intensity multiplier (x base intensity) when 2.5D is on. */
  parallax: number;
  /** True -> captions get the emphasis style on this beat. */
  captionEmphasis: boolean;
  /** Music bed level multiplier on this beat. */
  musicLevel: number;
}

export const STORY_BEATS: readonly StoryBeat[] = [
  {
    id: "hook",
    label: "Hook",
    share: 0.08,
    description:
      "Open on the single most surprising image or claim. One idea, landed in the first seconds.",
    motion: "slow_zoom",
    parallax: 0.6,
    captionEmphasis: true,
    musicLevel: 0.7,
  },
  {
    id: "setup",
    label: "Setup",
    share: 0.2,
    description: "Place the viewer: who, where, when. Context only — no payoff yet.",
    motion: "slow_pan",
    parallax: 0.7,
    captionEmphasis: false,
    musicLevel: 1.0,
  },
  {
    id: "rising_tension",
    label: "Rising tension",
    share: 0.42,
    description: "Raise the stakes scene by scene. Each scene ends on an unanswered question.",
    motion: "ken_burns",
    parallax: 1.0,
    captionEmphasis: false,
    musicLevel: 1.3,
  },
  {
    id: "payoff",
    label: "Payoff",
    share: 0.2,
    description: "Deliver the answer the tension promised. Say it plainly, once.",
    motion: "slow_zoom",
    parallax: 0.8,
    captionEmphasis: true,
    musicLevel: 1.1,
  },
  {
    id: "loop_cta",
    label: "Loop / CTA",
    share: 0.1,
    description: "Close the loop: echo the hook so the video replays cleanly, then one clear next step.",
    motion: "none",
    parallax: 0.4,
    captionEmphasis: false,
    musicLevel: 0.9,
  },
] as const;

export function storyBeatById(id: StoryBeatId): StoryBeat {
  return STORY_BEATS.find((b) => b.id === id)!;
}

/** Cumulative [start, end) time windows for the beats over a total runtime. */
export function storyBeatWindows(totalSeconds: number): { beat: StoryBeatId; start: number; end: number }[] {
  let t = 0;
  return STORY_BEATS.map((b, i) => {
    const start = t;
    // The last beat absorbs float rounding so windows tile exactly.
    const end = i === STORY_BEATS.length - 1 ? totalSeconds : t + b.share * totalSeconds;
    t = end;
    return { beat: b.id, start, end };
  });
}

/**
 * Assign every scene to a story beat by its midpoint time.
 * Pure and unit-tested; shared by the browser and worker render paths.
 */
export function assignStoryBeats(durations: number[]): StoryBeatId[] {
  const total = durations.reduce((a, d) => a + Math.max(0, d), 0);
  if (durations.length === 0 || total <= 0) return [];
  const windows = storyBeatWindows(total);
  let t = 0;
  return durations.map((d) => {
    const mid = t + Math.max(0, d) / 2;
    t += Math.max(0, d);
    const w = windows.find((w) => mid < w.end) ?? windows[windows.length - 1]!;
    return w.beat;
  });
}

/** Beat id at an absolute time (clamped into range). */
export function storyBeatAtTime(t: number, totalSeconds: number): StoryBeatId {
  if (totalSeconds <= 0) return "setup";
  const clamped = Math.min(Math.max(0, t), totalSeconds - 1e-6);
  const windows = storyBeatWindows(totalSeconds);
  return (windows.find((w) => clamped < w.end) ?? windows[windows.length - 1]!).beat;
}

/** Browser motion type for a beat (used when 2.5D parallax is off). */
export function storyBeatMotion(beat: StoryBeatId): StoryBeat["motion"] {
  return storyBeatById(beat).motion;
}

/** Parallax intensity multiplier for a beat (used when 2.5D parallax is on). */
export function storyParallaxMultiplier(beat: StoryBeatId): number {
  return storyBeatById(beat).parallax;
}

/** Whether captions get the emphasis style on this beat. */
export function storyCaptionEmphasis(beat: StoryBeatId): boolean {
  return storyBeatById(beat).captionEmphasis;
}

/**
 * Browser caption style override for a beat. Returns undefined when the beat
 * keeps the project's own caption style ("dynamic" punches up hook/payoff).
 */
export function storyCaptionStyle(beat: StoryBeatId): string | undefined {
  return storyCaptionEmphasis(beat) ? "dynamic" : undefined;
}

/** Music bed level multiplier for a beat. */
export function storyMusicLevel(beat: StoryBeatId): number {
  return storyBeatById(beat).musicLevel;
}

/** Ducking profile applied whenever Story Mode is on (both render paths). */
export const STORY_DUCK_PROFILE = {
  /** Lower threshold = the voice grabs the duck earlier. */
  threshold: 0.02,
  /** Deeper duck than the standard profile so the hook lands clean. */
  ratio: 10,
  /** Faster attack keeps the first word of each line intelligible. */
  attack: 20,
  release: 600,
} as const;

/** The standard (non-story) ducking profile, kept byte-identical to current behavior. */
export const STANDARD_DUCK_PROFILE = {
  threshold: 0.03,
  ratio: 8,
  attack: 25,
  release: 400,
} as const;

export function storyDuckParams(): string {
  const d = STORY_DUCK_PROFILE;
  return `threshold=${d.threshold}:ratio=${d.ratio}:attack=${d.attack}:release=${d.release}`;
}

/**
 * Per-beat music volume envelope as an ffmpeg `volume` expression.
 * Consecutive scenes on the same beat are merged so the filter stays short.
 * Wrap in single quotes when embedding in a filtergraph (commas).
 */
export function storyMusicSegments(durations: number[]): { end: number; level: number }[] {
  const beats = assignStoryBeats(durations);
  const out: { end: number; level: number }[] = [];
  let t = 0;
  for (let i = 0; i < durations.length; i++) {
    const d = Math.max(0, durations[i]!);
    t += d;
    const level = storyMusicLevel(beats[i]!);
    const last = out[out.length - 1];
    if (last && last.level === level) {
      last.end = t;
    } else {
      out.push({ end: t, level });
    }
  }
  return out;
}

/** `volume` filter expression: baseVolume scaled by the per-beat envelope. */
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

/**
 * Script-structure guidance appended to the narration plan prompt when
 * Story Mode is on. Language-neutral prose — names no languages.
 */
export const STORY_SCRIPT_GUIDANCE = `Story structure — shape the narration and the scene breakdown to follow these five beats in order:
1. HOOK (first ~8%): open on the single most surprising image or claim. One idea, landed fast.
2. SETUP (~20%): place the viewer — who, where, when. Context only, no payoff yet.
3. RISING TENSION (~42%): raise the stakes scene by scene; each scene ends on an unanswered question.
4. PAYOFF (~20%): deliver the answer the tension promised. Say it plainly, once.
5. LOOP / CTA (last ~10%): echo the hook so the video replays cleanly, then one clear next step.`;

/** Per-beat writing briefs for the studio UI. */
export function storyScriptBriefs(): { beat: StoryBeatId; label: string; brief: string }[] {
  return STORY_BEATS.map((b) => ({ beat: b.id, label: b.label, brief: b.description }));
}
