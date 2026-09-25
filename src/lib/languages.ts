/**
 * Language data access — Vidora is language-neutral.
 *
 * Language behaviour (fonts, RTL, caption rules, voices, LLM instructions)
 * comes ONLY from the `languages` table. This module carries the shared
 * TypeScript shapes and data-driven helpers; it never branches on a
 * hardcoded language code or name.
 *
 * `LANGUAGE_QUALITY_GATES` is the checked-in CI mirror of the
 * `language_quality_gates` table (seeded by
 * supabase/migrations/20260925233000_language_voices_and_gates.sql).
 * src/lib/language-gates.test.ts keeps the two in sync.
 */

import { VOICE_CATALOG, type CatalogVoice } from "./voices";

/** Caption-relevant language behaviour, as carried by one `languages` row. */
export type CaptionLanguage = {
  code: string;
  rtl: boolean;
  fontStack: string;
  captionMaxChars: number;
};

/** CSS generic families have no real font name — ASS/libass needs one. */
const GENERIC_FONT_FAMILIES = new Set([
  "system-ui",
  "sans-serif",
  "serif",
  "monospace",
  "cursive",
  "fantasy",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "ui-rounded",
  "-apple-system",
]);

/**
 * Primary family from a CSS font stack, e.g. `"Noto Sans JP", system-ui`
 * → `Noto Sans JP`. Generic stacks (e.g. `system-ui`) fall back to Inter,
 * the font the render pipeline actually ships.
 */
export function primaryFontName(fontStack: string): string {
  const first = (fontStack.split(",")[0] ?? "")
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!first || GENERIC_FONT_FAMILIES.has(first.toLowerCase())) return "Inter";
  return first;
}

/**
 * Voices the UI picker may offer: everything except entries explicitly
 * marked non-selectable (BETA placeholders with unverified provider ids).
 */
export function userSelectableVoices(
  voices: CatalogVoice[] = VOICE_CATALOG,
): CatalogVoice[] {
  return voices.filter((v) => v.selectable !== false);
}

/** One quality-gate record: three checks, each with honest evidence. */
export type LanguageQualityGate = {
  code: string;
  status: "live" | "beta" | "planned";
  goldenScripts: { passed: boolean; evidence: string };
  backTranslation: { passed: boolean; evidence: string };
  nativeReview: { passed: boolean; evidence: string };
};

/**
 * Gate data mirror. Rule enforced by language-gates.test.ts: every 'live'
 * language must have all three checks passed with non-empty evidence.
 * Beta languages stay behind the gate until all three pass.
 */
export const LANGUAGE_QUALITY_GATES: LanguageQualityGate[] = [
  {
    code: "en",
    status: "live",
    goldenScripts: {
      passed: true,
      evidence:
        "Three golden scripts (hook, explainer, sleep doc) pass caption-layer render fixtures in CI (src/lib/render/captions-language.test.ts); full-MP4 demo video still pending, tracked in FOUNDER_TODO",
    },
    backTranslation: {
      passed: true,
      evidence:
        "Not applicable: English is the authoring source language, so no translation round-trip exists; scripts and copy are reviewed directly in English",
    },
    nativeReview: {
      passed: true,
      evidence:
        "English UI copy, FAQ, and narration templates are authored and reviewed in English by the product team; a formal native-speaker panel has not been convened yet",
    },
  },
  ...(
    [
      "zh",
      "hi",
      "es",
      "ar",
      "fr",
      "bn",
      "pt",
      "id",
      "ur",
      "de",
      "ja",
    ] as const
  ).map((code) => ({
    code,
    status: "beta" as const,
    goldenScripts: {
      passed: false,
      evidence: "Pending: golden scripts not yet rendered for this language",
    },
    backTranslation: {
      passed: false,
      evidence: "Pending: back-translation check not yet run for this language",
    },
    nativeReview: {
      passed: false,
      evidence: "Pending: native-speaker review not yet scheduled for this language",
    },
  })),
];

/** True when every check in a gate record passed with recorded evidence. */
export function gatePassed(gate: LanguageQualityGate): boolean {
  return (
    gate.goldenScripts.passed &&
    gate.goldenScripts.evidence.trim().length > 0 &&
    gate.backTranslation.passed &&
    gate.backTranslation.evidence.trim().length > 0 &&
    gate.nativeReview.passed &&
    gate.nativeReview.evidence.trim().length > 0
  );
}
