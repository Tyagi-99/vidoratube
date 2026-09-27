/**
 * F23 — deterministic 30-second script builder (pure, no LLM, no credits).
 *
 * Quick Create targets a tight short: hook → fact beats → payoff, 25–35s
 * of narration at 150 WPM (≈ 62–88 words). The builder assembles the script
 * from caller-supplied, source-verified facts — it never invents facts.
 * Each beat carries the fact text and optional source ids so the research
 * stage's claim linking can be preserved end-to-end.
 */
import { STUDIO_WORDS_PER_MINUTE } from "../video-studio/manifest";

export type QuickScriptFact = {
  /** Source-verified fact text (must already be researched). */
  text: string;
  /** research_sources ids backing this fact (may be empty when unlinked). */
  sourceIds: string[];
};

export type QuickScriptInput = {
  topic: string;
  /** One-line hook (question or curiosity gap). */
  hook: string;
  facts: QuickScriptFact[];
  /** Closing payoff line. */
  payoff: string;
};

export type QuickScript = {
  hook: string;
  beats: string[];
  payoff: string;
  fullText: string;
  wordCount: number;
  /** ESTIMATE at 150 WPM until measured from real narration audio. */
  durationSecEstimate: number;
  inTargetWindow: boolean;
};

/** Target window for a 30-second quick create. */
export const QUICK_SCRIPT_MIN_SEC = 25;
export const QUICK_SCRIPT_MAX_SEC = 35;

const BEAT_TRANSITIONS = [
  "Here's what's really going on.",
  "And it gets better.",
  "Now for the clever part.",
];

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function buildQuickScript(input: QuickScriptInput): QuickScript {
  const hook = input.hook.trim();
  const payoff = input.payoff.trim();
  const facts = input.facts.map((f) => f.text.trim()).filter(Boolean);
  if (!hook) throw new Error("Quick script needs a hook.");
  if (facts.length === 0) throw new Error("Quick script needs at least one verified fact.");
  if (!payoff) throw new Error("Quick script needs a payoff line.");

  const beats: string[] = [];
  facts.forEach((fact, i) => {
    const transition = BEAT_TRANSITIONS[i % BEAT_TRANSITIONS.length];
    beats.push(i === 0 ? `${transition} ${fact}` : `${fact}`);
  });

  const fullText = [hook, ...beats, payoff].join(" ");
  const wordCount = words(fullText);
  const durationSecEstimate = (wordCount / STUDIO_WORDS_PER_MINUTE) * 60;
  return {
    hook,
    beats,
    payoff,
    fullText,
    wordCount,
    durationSecEstimate,
    inTargetWindow:
      durationSecEstimate >= QUICK_SCRIPT_MIN_SEC && durationSecEstimate <= QUICK_SCRIPT_MAX_SEC,
  };
}
