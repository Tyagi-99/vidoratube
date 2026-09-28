/**
 * Phase 6 Stream B — onboarding server functions.
 *
 * Thin adapters over `public.onboarding_progress` (migration
 * 2026092806a000_onboarding.sql — applied live by the coordinator, NOT here).
 * Owner-only RLS on the table is the enforcement boundary, so these use the
 * caller's own session client (`context.supabase`), exactly like the
 * research surfaces. Every handler is gated by `requireAppUser`.
 *
 * The table is not yet in the generated `Database` types (migration pending
 * live apply), so queries go through the structural `UntypedDb` surface —
 * the same approach Phase 5 used for the agent tables
 * (src/lib/agent/agent.server.ts). Regenerate `src/integrations/supabase/types.ts`
 * after the migration is applied live, then these can drop the cast.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "@/lib/server-auth";
import type { Json } from "@/integrations/supabase/types";
import type { UntypedDb } from "@/lib/supabase/untyped";
import { ONBOARDING_STEPS, isOnboardingStep, mergeAnswers } from "./onboarding";

const StepSchema = z.enum(ONBOARDING_STEPS);

const AnswersSchema = z
  .record(z.string(), z.unknown())
  .refine(
    (a) => JSON.stringify(a).length <= 20_000,
    "Answers payload is too large.",
  );

/**
 * Wizard answers as JSON — the serializable shape of the `answers` jsonb
 * column. (TanStack Start server functions must return serializable values,
 * so `Record<string, unknown>` is not allowed here.)
 */
export type OnboardingAnswers = Record<string, Json>;

export interface OnboardingState {
  current_step: string;
  completed: boolean;
  answers: OnboardingAnswers;
}

function rowToState(row: Record<string, unknown>): OnboardingState {
  const current_step =
    typeof row["current_step"] === "string" && isOnboardingStep(row["current_step"])
      ? row["current_step"]
      : "welcome";
  const answers =
    row["answers"] !== null && typeof row["answers"] === "object"
      ? (row["answers"] as OnboardingAnswers)
      : {};
  return { current_step, completed: row["completed"] === true, answers };
}

/** Current progress, or null when the user never started the wizard. */
export const getOnboardingState = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .handler(async ({ context }): Promise<OnboardingState | null> => {
    const db = context.supabase as unknown as UntypedDb;
    const { data, error } = await db
      .from("onboarding_progress")
      .select("current_step, completed, answers")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return rowToState(data);
  });

/** Advance the wizard: merge answers and move `current_step` forward. */
export const saveOnboardingProgress = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) =>
    z
      .object({
        step: StepSchema,
        answers: AnswersSchema.optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<OnboardingState> => {
    const db = context.supabase as unknown as UntypedDb;
    const incoming = (data.answers ?? {}) as Record<string, unknown>;
    const { data: existing, error: readError } = await db
      .from("onboarding_progress")
      .select("answers")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    const merged = mergeAnswers(
      ((existing?.["answers"] ?? {}) as Record<string, unknown>),
      incoming,
    );
    const { data: row, error } = await db
      .from("onboarding_progress")
      .upsert(
        {
          user_id: context.userId,
          current_step: data.step,
          answers: merged,
          completed: false,
        },
        { onConflict: "user_id" },
      )
      .select("current_step, completed, answers")
      .single();
    if (error) throw new Error(error.message);
    return rowToState(row);
  });

/** Finish (or skip) the wizard. After this, /onboarding redirects to /studio. */
export const completeOnboarding = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .handler(async ({ context }): Promise<OnboardingState> => {
    const db = context.supabase as unknown as UntypedDb;
    // Preserve collected answers — completing must never wipe them.
    const { data: existing, error: readError } = await db
      .from("onboarding_progress")
      .select("current_step, answers")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    const currentStep =
      existing &&
      typeof existing["current_step"] === "string" &&
      isOnboardingStep(existing["current_step"])
        ? existing["current_step"]
        : "video";
    const { data: row, error } = await db
      .from("onboarding_progress")
      .upsert(
        {
          user_id: context.userId,
          current_step: currentStep,
          answers:
            existing &&
            typeof existing["answers"] === "object" &&
            existing["answers"] !== null
              ? existing["answers"]
              : {},
          completed: true,
        },
        { onConflict: "user_id" },
      )
      .select("current_step, completed, answers")
      .single();
    if (error) throw new Error(error.message);
    return rowToState(row);
  });
