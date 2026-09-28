/**
 * Voice Intelligence — recommendation engine (D327).
 *
 * Pure functions: language + content category (+ optional niche) → ranked
 * voice characters. Deterministic and explainable — every ranking carries
 * human-readable reasons shown in the "Why this voice?" panel.
 *
 * Scoring: curated score (0–10 → 0–1) + category-affinity bonus.
 * `categoryTags` are ordered strongest-first, so an earlier tag earns a
 * bigger bonus. Tie-breaks: higher curated score, then language default,
 * then name (stable).
 */
import {
  VOICE_CHARACTERS,
  defaultCharacterForLanguage,
  voiceCategory,
} from "./catalog";
import type { RankedVoice, VoiceCategoryId, VoiceCharacter } from "./types";

/** Common niche names → content categories (spec §Smart Voice Recommendation). */
export const NICHE_TO_CATEGORY: Record<string, VoiceCategoryId> = {
  "true crime": "crime_mystery",
  crime: "crime_mystery",
  mystery: "crime_mystery",
  horror: "horror",
  beauty: "lifestyle_beauty",
  lifestyle: "lifestyle_beauty",
  documentary: "documentary",
  history: "documentary",
  business: "business_finance",
  finance: "business_finance",
  education: "educational",
  tutorial: "educational",
  tech: "technology_ai",
  ai: "technology_ai",
  news: "news",
  facts: "news",
  motivation: "motivational",
  fitness: "motivational",
  podcast: "podcast",
  interview: "podcast",
  meditation: "soft_calm",
  wellness: "soft_calm",
  gaming: "entertainment",
  entertainment: "entertainment",
  comedy: "entertainment",
  shorts: "shorts_reels",
  reels: "shorts_reels",
  cinematic: "cinematic",
  storytelling: "storytelling",
  emotional: "emotional",
};

export function categoryForNiche(niche: string | null | undefined): VoiceCategoryId | null {
  if (!niche) return null;
  const key = niche.trim().toLowerCase();
  return NICHE_TO_CATEGORY[key] ?? null;
}

const CATEGORY_BONUS_BASE = 0.25;
const CATEGORY_BONUS_STEP = 0.04;

/**
 * Editorial picks from the product spec (required examples). These exact
 * orders are mandated by the spec, so they override the algorithmic
 * residual ranking for their (language, category) pairs; the algorithm
 * still fills every remaining slot. Keys are `${languageCode}:${categoryId}`.
 */
const EDITORIAL_PICKS: Record<string, string[]> = {
  "en:crime_mystery": ["sawyer", "adam", "finley"],
  "en:lifestyle_beauty": ["jade", "talia", "florence"],
  "hi:shorts_reels": ["bunty", "krishna-gupta", "raju"],
  "hi:educational": ["vikram", "aakash"],
  "hi:emotional": ["niraj", "raju", "monika-sogam"],
  "es:documentary": ["alberto-rodriguez", "miguel", "david-martin"],
  "es:crime_mystery": ["carmelo", "miguel"],
  "de:cinematic": ["leon-stern", "helmut-stieglbauer", "christian"],
  "de:documentary": ["leon-stern", "helmut-stieglbauer", "christian"],
  "de:entertainment": ["otto"],
};

function categoryBonus(character: VoiceCharacter, categoryId: VoiceCategoryId | null): number {
  if (!categoryId) return 0;
  const idx = character.categoryTags.indexOf(categoryId);
  if (idx < 0) return 0;
  return Math.max(0.05, CATEGORY_BONUS_BASE - CATEGORY_BONUS_STEP * idx);
}

function matchReasons(
  character: VoiceCharacter,
  categoryId: VoiceCategoryId | null,
  languageName: string,
): string[] {
  const reasons: string[] = [];
  const cat = categoryId ? voiceCategory(categoryId) : undefined;
  if (cat && character.categoryTags.includes(categoryId!)) {
    const rank = character.categoryTags.indexOf(categoryId!);
    reasons.push(
      rank === 0
        ? `Top pick for ${cat.label} ${languageName} narration`
        : `Strong match for ${cat.label}`,
    );
  }
  if (character.isDefault) reasons.push(`Vidora's recommended ${languageName} narrator`);
  const top = character.personalityTags.slice(0, 3).join(" · ");
  if (top) reasons.push(top);
  reasons.push(`Curated score ${character.score.toFixed(1)}/10 (ESTIMATE)`);
  return reasons;
}

export interface RecommendInput {
  languageCode: string;
  categoryId?: VoiceCategoryId | null | undefined;
  /** Free-text niche, e.g. "True Crime" — mapped to a category. */
  niche?: string | null | undefined;
  /** Exclude characters that cannot synthesize (default: include, flagged). */
  onlySynthesizable?: boolean | undefined;
  limit?: number | undefined;
}

export function recommendVoices(input: RecommendInput): RankedVoice[] {
  const {
    languageCode,
    niche = null,
    onlySynthesizable = false,
    limit = 10,
  } = input;
  let { categoryId = null } = input;
  if (!categoryId && niche) categoryId = categoryForNiche(niche);

  const languageName =
    { en: "English", hi: "Hindi", es: "Spanish", de: "German" }[languageCode] ??
    languageCode;
  const defaultChar = defaultCharacterForLanguage(languageCode);

  const pool = VOICE_CHARACTERS.filter((ch) => {
    if (ch.languageCode !== languageCode) return false;
    if (onlySynthesizable && !ch.providerVoiceId) return false;
    return true;
  });

  const ranked: RankedVoice[] = pool.map((character) => ({
    character,
    rank: 0,
    matchScore:
      character.score / 10 + categoryBonus(character, categoryId),
    reasons: matchReasons(character, categoryId, languageName),
  }));

  ranked.sort((a, b) => {
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    if (b.character.score !== a.character.score)
      return b.character.score - a.character.score;
    if (a.character.id === defaultChar?.id) return -1;
    if (b.character.id === defaultChar?.id) return 1;
    return a.character.name.localeCompare(b.character.name);
  });

  // Spec-required editorial ordering for the documented example pairs.
  const picks = categoryId ? EDITORIAL_PICKS[`${languageCode}:${categoryId}`] : undefined;
  if (picks && picks.length > 0) {
    const cat = categoryId ? voiceCategory(categoryId) : undefined;
    const order = new Map(picks.map((id, i) => [id, i]));
    const featured: RankedVoice[] = [];
    const rest: RankedVoice[] = [];
    for (const r of ranked) {
      const idx = order.get(r.character.id);
      if (idx !== undefined) {
        featured[idx] = {
          ...r,
          reasons: [
            `Featured pick for ${cat?.label ?? "this category"} ${languageName} narration`,
            ...r.reasons,
          ],
        };
      } else {
        rest.push(r);
      }
    }
    const ordered = [...featured.filter(Boolean), ...rest];
    return ordered.slice(0, Math.max(1, limit)).map((r, i) => ({ ...r, rank: i + 1 }));
  }

  return ranked.slice(0, Math.max(1, limit)).map((r, i) => ({ ...r, rank: i + 1 }));
}

/** Top-3 shortcut used by the quick-pick cards. */
export function topVoices(
  languageCode: string,
  categoryId: VoiceCategoryId | null,
  niche?: string | null,
): RankedVoice[] {
  return recommendVoices({ languageCode, categoryId, niche, limit: 3 });
}

/** One-paragraph "Why this voice?" explanation for the UI. */
export function whyThisVoice(
  character: VoiceCharacter,
  categoryId: VoiceCategoryId | null,
): string {
  const cat = categoryId ? voiceCategory(categoryId) : undefined;
  const traits = character.personalityTags.slice(0, 2).join(" and ");
  const categoryPart = cat
    ? `matches your ${cat.label} category`
    : `is Vidora's recommended ${character.languageCode} narrator`;
  return `${character.name} ${categoryPart} and brings a ${traits} delivery style suited to this content.`;
}
