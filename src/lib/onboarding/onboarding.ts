/**
 * Phase 6 Stream B — onboarding wizard state machine (pure, testable).
 *
 * Steps: welcome -> connect -> creator-type -> niche -> goal -> brand ->
 *        scan -> idea -> video. `connect` and `scan` are skippable
 * (D220). Progress is persisted in `public.onboarding_progress` so a user
 * resumes at `current_step` after tab closes, OAuth round-trips, etc.
 */

export const ONBOARDING_STEPS = [
  "welcome",
  "connect",
  "creator-type",
  "niche",
  "goal",
  "brand",
  "scan",
  "idea",
  "video",
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export function isOnboardingStep(value: unknown): value is OnboardingStep {
  return (
    typeof value === "string" &&
    (ONBOARDING_STEPS as readonly string[]).includes(value)
  );
}

export function stepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step);
}

/** The step after `step`, or null when the wizard ends (finish on "video"). */
export function nextStep(step: OnboardingStep): OnboardingStep | null {
  const i = stepIndex(step);
  return i < 0 || i >= ONBOARDING_STEPS.length - 1 ? null : (ONBOARDING_STEPS[i + 1] ?? null);
}

/** The step before `step`, or null on the first step. */
export function prevStep(step: OnboardingStep): OnboardingStep | null {
  const i = stepIndex(step);
  return i <= 0 ? null : (ONBOARDING_STEPS[i - 1] ?? null);
}

/**
 * Steps the user may skip without providing an answer.
 * - connect: YouTube can be linked later from the studio (D220).
 * - scan: the niche scan costs a research credit; skipping is honest (D220).
 */
export function isSkippable(step: OnboardingStep): boolean {
  return step === "connect" || step === "scan";
}

export interface OnboardingRow {
  current_step: string;
  completed: boolean;
  answers: Record<string, unknown>;
}

/**
 * Decide what the /onboarding route should do for a user.
 * - no row (brand-new user, e.g. fresh signup) -> start the wizard at "welcome"
 *   (the first step save upserts the progress row; D306 fixes the D221 bug
 *   that bounced new users straight to /studio)
 * - row with completed=true                  -> redirect to /studio (auto-skip)
 * - row with an unknown/invalid step          -> start over at "welcome" (defensive)
 * - otherwise                                 -> resume at the persisted step
 */
export function resolveOnboardingEntry(
  row: OnboardingRow | null,
): { action: "redirect"; to: "/studio" } | { action: "resume"; step: OnboardingStep } {
  if (!row) return { action: "resume", step: "welcome" };
  if (row.completed) return { action: "redirect", to: "/studio" };
  if (isOnboardingStep(row.current_step)) return { action: "resume", step: row.current_step };
  return { action: "resume", step: "welcome" };
}

/**
 * Merge newly collected answers over the persisted ones. New keys win;
 * `undefined` values are dropped so they never wipe existing answers.
 */
export function mergeAnswers(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

/** A step is only submittable when its required answers are present. */
export function stepAnswersValid(
  step: OnboardingStep,
  answers: Record<string, unknown>,
): boolean {
  switch (step) {
    case "welcome":
      return true;
    case "connect":
      // connection is verified against YouTube, not stored in answers
      return true;
    case "creator-type":
      return (
        typeof answers["creator_type"] === "string" && answers["creator_type"].length > 0
      );
    case "niche":
      return (
        typeof answers["niche"] === "string" && answers["niche"].trim().length >= 2
      );
    case "goal":
      return typeof answers["goal"] === "string" && answers["goal"].length > 0;
    case "brand":
      return (
        typeof answers["channel_name"] === "string" &&
        answers["channel_name"].trim().length >= 2
      );
    case "scan":
    case "idea":
      // idea is free-text; validated at the UI (non-empty trimmed)
      return true;
    case "video":
      return true;
  }
}
