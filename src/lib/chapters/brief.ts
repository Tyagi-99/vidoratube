/**
 * Sprint 3-4: the continuity brief.
 *
 * A single JSON brief is generated ONCE per chapter-mode render and passed
 * to EVERY chapter render, so voice, pacing, and visual style stay
 * consistent across chapters. It is stored on the parent render row at
 * `meta.continuityBrief`; the worker hands the identical object to each
 * chapter render (reference equality is asserted in worker tests).
 *
 * Pure and deterministic: the same inputs always produce a deep-equal
 * brief. Language-neutral: `languageCode` is a BCP-47 tag carried through
 * to the TTS provider — the brief never branches on it.
 */
import { z } from "zod";

export const ContinuityBriefSchema = z.object({
  version: z.literal(1),
  voice: z.object({
    id: z.string(),
    languageCode: z.string(),
    model: z.string(),
  }),
  pacing: z.object({
    /** Words per minute used to estimate (not dictate) timing. */
    wordsPerMinute: z.number().positive(),
  }),
  visuals: z.object({
    background: z.object({
      type: z.literal("solid"),
      /** Hex color, e.g. "0x17130e". */
      color: z.string(),
    }),
    captionStyle: z.object({
      font: z.string(),
      fontSize: z.number().positive(),
      /** ASS primary color, e.g. "&H00FFFFFF". */
      primaryColor: z.string(),
    }),
  }),
  /** Free-text tone guidance (kept short; no per-language variants). */
  tone: z.string(),
});

export type ContinuityBrief = z.infer<typeof ContinuityBriefSchema>;

const DEFAULT_TONE =
  "Steady documentary pacing. Clear, neutral narration with natural " +
  "emphasis. No abrupt shifts in energy, formality, or visual treatment " +
  "between chapters — the viewer must not feel the seams.";

export function buildContinuityBrief(input: {
  voiceId: string;
  languageCode: string;
  voiceModel?: string;
  wordsPerMinute?: number;
  tone?: string;
}): ContinuityBrief {
  const brief = {
    version: 1 as const,
    voice: {
      id: input.voiceId,
      languageCode: input.languageCode,
      model: input.voiceModel ?? "eleven_flash_v2_5",
    },
    pacing: {
      wordsPerMinute: input.wordsPerMinute ?? 150,
    },
    visuals: {
      background: { type: "solid" as const, color: "0x17130e" },
      captionStyle: {
        font: "Inter",
        fontSize: 64,
        primaryColor: "&H00FFFFFF",
      },
    },
    tone: input.tone ?? DEFAULT_TONE,
  };
  return ContinuityBriefSchema.parse(brief);
}
