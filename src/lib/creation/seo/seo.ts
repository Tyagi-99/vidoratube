/**
 * F26 — SEO & Metadata Studio (pure, deterministic, no LLM, no credits).
 *
 * Title work reuses Stream A's `generateTitleVariants` / `scoreTitle`
 * (stats-disciplined, no CTR-prediction claims — see titles.ts). Description,
 * hashtags, and thumbnail concepts are deterministic templates so the
 * studio is fully usable with zero provider keys; an LLM rewrite can be
 * layered later behind credit preflight.
 *
 * Hashtag/thumbnail outputs never claim predicted performance — concepts
 * carry the *reasoning* (curiosity gap, specificity, readability), never a
 * CTR promise.
 */
import { generateTitleVariants, scoreTitle } from "../titles/titles";
import { extractIdeaKeywords } from "../ideas/scorer";
import type { TitleScore } from "../contracts";

export type SeoPackageInput = {
  topic: string;
  /** Working title or selected variant. */
  title: string;
  /** Source-verified facts to weave into the description. */
  facts: string[];
  /** Optional brand/channel name for the description sign-off. */
  brandName?: string | undefined;
  /** Source URLs to cite in the description. */
  sourceUrls?: string[] | undefined;
  maxHashtags?: number | undefined;
};

export type SeoTitleOption = { title: string; score: TitleScore };

export type ThumbnailConcept = {
  /** Short working name, e.g. "Curiosity close-up". */
  name: string;
  /** What the thumbnail shows (composition brief for a designer). */
  composition: string;
  /** On-thumbnail text — ≤ 4 words, never a CTR promise. */
  overlayText: string;
  /** Why this concept (design reasoning, not a performance prediction). */
  rationale: string;
};

export type SeoPackage = {
  titleOptions: SeoTitleOption[];
  chosenTitle: string;
  description: string;
  hashtags: string[];
  thumbnailConcepts: ThumbnailConcept[];
  generatedAt: string;
};

/** Title variants via Stream A's deterministic generator, scored + ranked. */
export function buildTitleOptions(topic: string, keywords: string[], max = 6): SeoTitleOption[] {
  return generateTitleVariants({ topic, keywords, maxVariants: max })
    .map((title) => ({ title, score: scoreTitle({ title, keywords }) }))
    .sort((a, b) => b.score.total - a.score.total);
}

function cleanHashtag(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Deterministic hashtags: niche keywords + topic compounds, capped. */
export function buildHashtags(topic: string, hook: string, max = 12): string[] {
  const keywords = extractIdeaKeywords(topic, hook, "", 8).map(cleanHashtag).filter(Boolean);
  const topicWords = topic
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
  const out: string[] = [];
  const push = (tag: string) => {
    const t = `#${cleanHashtag(tag)}`;
    if (t.length > 2 && !out.includes(t)) out.push(t);
  };
  for (const k of keywords) push(k);
  if (topicWords.length >= 2) push(topicWords.slice(0, 2).join(""));
  push("shorts");
  push("didyouknow");
  return out.slice(0, max);
}

/** Deterministic description: hook + facts + sources + hashtags. */
export function buildDescription(input: SeoPackageInput, hashtags: string[]): string {
  const lines: string[] = [];
  lines.push(input.title);
  lines.push("");
  if (input.facts.length > 0) {
    lines.push(...input.facts.map((f) => `• ${f}`));
    lines.push("");
  }
  const urls = (input.sourceUrls ?? []).filter(Boolean);
  if (urls.length > 0) {
    lines.push("Sources:");
    for (const u of urls) lines.push(u);
    lines.push("");
  }
  if (input.brandName) lines.push(`From ${input.brandName} — new explainers every week.`);
  if (hashtags.length > 0) {
    lines.push("");
    lines.push(hashtags.join(" "));
  }
  return lines.join("\n").trim();
}

/** Three thumbnail concepts — composition briefs with honest rationales. */
export function buildThumbnailConcepts(topic: string, facts: string[]): ThumbnailConcept[] {
  const short = topic.replace(/\?+\s*$/, "");
  const fact = facts[0] ?? `The surprising truth about ${short.toLowerCase()}`;
  return [
    {
      name: "Curiosity close-up",
      composition: `Extreme close-up of the subject of "${short}" filling the frame, dark vignette, one glowing accent element.`,
      overlayText: "Wait… WHAT?",
      rationale:
        "Curiosity-gap text plus a tight crop gives the eye one place to land; no performance is predicted.",
    },
    {
      name: "Fact callout",
      composition: `Split frame: left side the everyday object (${short}), right side a simple diagram/annotation style panel.`,
      overlayText: fact.split(/\s+/).slice(0, 4).join(" "),
      rationale:
        "Pairs the hook with a concrete visual promise so the thumbnail and title reinforce each other.",
    },
    {
      name: "Bold question",
      composition: `High-contrast background, subject centered, large condensed type occupying the top third with generous letter-spacing.`,
      overlayText:
        short.split(/\s+/).filter(Boolean).length > 4
          ? `${short.split(/\s+/).filter(Boolean).slice(0, 4).join(" ")}…?`
          : `${short}?`,
      rationale:
        "Question-format overlay mirrors the title's curiosity gap; ≤4-word text stays readable at small sizes.",
    },
  ];
}

export function buildSeoPackage(input: SeoPackageInput): SeoPackage {
  const keywords = extractIdeaKeywords(input.topic, input.title, "", 8);
  const titleOptions = buildTitleOptions(input.topic, keywords, 6);
  const hashtags = buildHashtags(input.topic, input.title, input.maxHashtags ?? 12);
  const description = buildDescription(input, hashtags);
  return {
    titleOptions,
    chosenTitle: titleOptions[0]?.title ?? input.title,
    description,
    hashtags,
    thumbnailConcepts: buildThumbnailConcepts(input.topic, input.facts),
    generatedAt: new Date().toISOString(),
  };
}
