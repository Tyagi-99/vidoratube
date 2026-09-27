/**
 * F24 Shorts Repurposing — pure short recut planner.
 *
 * Given a source project and a user-selected subset of scenes, produces a
 * deterministic 9:16 recut plan: reordered (hook-first) scene list, a
 * tighter narration script, title, and hashtags. Hook detection is an honest
 * RULE-BASED heuristic — the plan labels it as such so the UI never claims
 * AI analysis it didn't do. Same scene/render pipeline downstream: the plan
 * feeds the EXISTING enqueueServerRender path with meta.kind = "short" and
 * renders.parent_id pointing at the source project (D54 pattern).
 */
import { estimateSceneDurationSec } from "../video-studio/manifest";

/** Scene facts the planner needs (already estimates — no audio measurement here). */
export interface ShortSourceScene {
  sceneId: string;
  sceneNumber: number;
  narration: string;
  assetUrl: string | null;
  durationSecEstimate: number;
  /** Caller-supplied: whether the scene was already picked by the user. */
  selected: boolean;
}

export interface PlanShortInput {
  projectId: string;
  projectTitle: string;
  scenes: ShortSourceScene[];
  /** Cap the recut length. Default 60s (Shorts ceiling). */
  maxDurationSec?: number;
}

export interface ShortPlanScene {
  sceneId: string;
  narration: string;
  /** Tightened narration for the recut — first sentence, capped at 28 words. */
  recutNarration: string;
  image: string | null;
  durationSecEstimate: number;
}

export interface ShortPlan {
  /** Deterministic scene order (hook scene first). */
  scenes: ShortPlanScene[];
  orderedSceneIds: string[];
  aspect: "9:16";
  title: string;
  hashtags: string[];
  recutScript: string;
  estimatedDurationSec: number;
  hookSceneId: string | null;
  /** Honest provenance label — always rule-based in this build. */
  hookAnalysisNote: string;
  resequencingNote: string;
  missingVisuals: number;
}

const DEFAULT_MAX_DURATION_SEC = 60;
const RECUT_WORD_CAP = 28;

const HOOK_OPENERS = [
  /^(did you know|what if|imagine|stop|never|nobody|here'?s |this is|why |how )/i,
  /[?!]\s*$/,
];

function isHookCandidate(narration: string): boolean {
  const head = narration.trim().slice(0, 80);
  return HOOK_OPENERS.some((re) => re.test(head));
}

/** Tighten a narration to its first sentence, capped at RECUT_WORD_CAP words. */
export function tightenNarration(narration: string): string {
  const firstSentence = narration
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .find((s) => s.length > 0);
  const words = (firstSentence ?? narration).split(/\s+/).filter(Boolean);
  const capped = words.slice(0, RECUT_WORD_CAP);
  const text = capped.join(" ");
  return words.length > RECUT_WORD_CAP ? `${text}…` : text;
}

function deriveTitle(projectTitle: string, hookScene: ShortSourceScene | null): string {
  const base = projectTitle.replace(/\s*\(Short\)\s*$/i, "").trim() || "Untitled";
  if (hookScene) {
    const words = hookScene.narration.split(/\s+/).filter(Boolean).slice(0, 6).join(" ");
    if (words) return `${words}… #shorts`.slice(0, 90);
  }
  return `${base} (Short)`;
}

const GENERIC_HASHTAGS = ["#shorts", "#reels", "#viral"];

function deriveHashtags(projectTitle: string): string[] {
  const keywords = projectTitle
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 3)
    .map((w) => `#${w}`);
  return [...new Set([...GENERIC_HASHTAGS, ...keywords])].slice(0, 6);
}

/**
 * Plan a short recut. Deterministic: same input → same output.
 *
 * 1. Keeps only selected scenes (in the user's scene-number order).
 * 2. Moves the first rule-based hook candidate to the front.
 * 3. Tightens narration and truncates the list to fit maxDurationSec.
 */
export function planShortRecut(input: PlanShortInput): ShortPlan {
  const maxDurationSec = input.maxDurationSec ?? DEFAULT_MAX_DURATION_SEC;
  const selected = input.scenes
    .filter((s) => s.selected)
    .sort((a, b) => a.sceneNumber - b.sceneNumber);
  if (selected.length === 0) throw new Error("Select at least one scene for the short");

  const hookIndex = selected.findIndex((s) => isHookCandidate(s.narration));
  const ordered =
    hookIndex > 0
      ? [selected[hookIndex]!, ...selected.filter((_, i) => i !== hookIndex)]
      : [...selected];

  // Fit the duration cap greedily in order (hook scene always survives).
  const scenes: ShortPlanScene[] = [];
  let total = 0;
  for (const s of ordered) {
    const recutNarration = tightenNarration(s.narration);
    const duration = estimateSceneDurationSec(recutNarration, null);
    if (scenes.length > 0 && total + duration > maxDurationSec) break;
    scenes.push({
      sceneId: s.sceneId,
      narration: s.narration,
      recutNarration,
      image: s.assetUrl,
      durationSecEstimate: duration,
    });
    total += duration;
  }

  const hookScene = hookIndex >= 0 ? selected[hookIndex]! : null;
  const missingVisuals = scenes.filter((s) => !s.image).length;
  const title = deriveTitle(input.projectTitle, hookScene);
  const recutScript = scenes.map((s) => s.recutNarration).join("\n\n");

  return {
    scenes,
    orderedSceneIds: scenes.map((s) => s.sceneId),
    aspect: "9:16",
    title,
    hashtags: deriveHashtags(input.projectTitle),
    recutScript,
    estimatedDurationSec: Math.round(total * 10) / 10,
    hookSceneId: hookScene?.sceneId ?? null,
    hookAnalysisNote:
      hookScene != null
        ? `Rule-based hook suggestion (not AI analysis): scene ${hookScene.sceneNumber} opens with a question/exclamation-style hook, so it leads the recut.`
        : "Rule-based hook suggestion (not AI analysis): no strong opener detected — scenes keep your selected order.",
    resequencingNote:
      hookIndex > 0
        ? `Hook-first resequence: scene ${selected[hookIndex]!.sceneNumber} moved to the front; the rest keep your order.`
        : "Order kept: your selected scene order (no resequence needed).",
    missingVisuals,
  };
}
