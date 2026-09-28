/**
 * Phase 6 Stream B — onboarding state machine tests.
 *
 * Pure functions from src/lib/onboarding/onboarding.ts — deterministic data,
 * no network, no DB.
 */
import { describe, expect, it } from "vitest";
import {
  ONBOARDING_STEPS,
  isOnboardingStep,
  isSkippable,
  mergeAnswers,
  nextStep,
  prevStep,
  resolveOnboardingEntry,
  stepAnswersValid,
  stepIndex,
} from "./onboarding";

describe("onboarding step order", () => {
  it("has the nine wizard steps in order", () => {
    expect([...ONBOARDING_STEPS]).toEqual([
      "welcome",
      "connect",
      "creator-type",
      "niche",
      "goal",
      "brand",
      "scan",
      "idea",
      "video",
    ]);
  });

  it("nextStep walks forward and ends at video", () => {
    let step: string | null = "welcome";
    const visited: string[] = [];
    while (step) {
      visited.push(step);
      step = nextStep(step as never);
    }
    expect(visited).toEqual([...ONBOARDING_STEPS]);
    expect(nextStep("video")).toBeNull();
  });

  it("prevStep walks backward and stops at welcome", () => {
    expect(prevStep("welcome")).toBeNull();
    expect(prevStep("connect")).toBe("welcome");
    expect(prevStep("video")).toBe("idea");
  });

  it("stepIndex matches position", () => {
    expect(stepIndex("welcome")).toBe(0);
    expect(stepIndex("video")).toBe(ONBOARDING_STEPS.length - 1);
  });

  it("isOnboardingStep rejects unknown values", () => {
    expect(isOnboardingStep("welcome")).toBe(true);
    expect(isOnboardingStep("done")).toBe(false);
    expect(isOnboardingStep(null)).toBe(false);
    expect(isOnboardingStep(undefined)).toBe(false);
    expect(isOnboardingStep(42)).toBe(false);
  });
});

describe("skip logic (D220)", () => {
  it("connect and scan are skippable; nothing else is", () => {
    expect(isSkippable("connect")).toBe(true);
    expect(isSkippable("scan")).toBe(true);
    for (const step of ONBOARDING_STEPS) {
      if (step !== "connect" && step !== "scan") {
        expect(isSkippable(step)).toBe(false);
      }
    }
  });
});

describe("resume logic (D221, fixed by D306)", () => {
  it("no row -> start the wizard at welcome (brand-new user)", () => {
    expect(resolveOnboardingEntry(null)).toEqual({ action: "resume", step: "welcome" });
  });

  it("completed row -> redirect to /studio (auto-skip)", () => {
    expect(
      resolveOnboardingEntry({ current_step: "video", completed: true, answers: {} }),
    ).toEqual({ action: "redirect", to: "/studio" });
  });

  it("in-progress row resumes at the persisted step", () => {
    expect(
      resolveOnboardingEntry({ current_step: "niche", completed: false, answers: {} }),
    ).toEqual({ action: "resume", step: "niche" });
    expect(
      resolveOnboardingEntry({ current_step: "video", completed: false, answers: {} }),
    ).toEqual({ action: "resume", step: "video" });
  });

  it("a row with an unknown step restarts defensively at welcome", () => {
    expect(
      resolveOnboardingEntry({ current_step: "mystery", completed: false, answers: {} }),
    ).toEqual({ action: "resume", step: "welcome" });
  });
});

describe("mergeAnswers", () => {
  it("new keys win, existing keys survive, undefined never wipes", () => {
    const merged = mergeAnswers(
      { creator_type: "faceless", niche: "finance" },
      { niche: "history", goal: "views", channel_name: undefined },
    );
    expect(merged).toEqual({
      creator_type: "faceless",
      niche: "history",
      goal: "views",
    });
  });
});

describe("stepAnswersValid", () => {
  it("requires the collected answers for each gated step", () => {
    expect(stepAnswersValid("creator-type", { creator_type: "faceless" })).toBe(true);
    expect(stepAnswersValid("creator-type", {})).toBe(false);
    expect(stepAnswersValid("niche", { niche: "AI gadgets" })).toBe(true);
    expect(stepAnswersValid("niche", { niche: " " })).toBe(false);
    expect(stepAnswersValid("goal", { goal: "views" })).toBe(true);
    expect(stepAnswersValid("goal", {})).toBe(false);
    expect(stepAnswersValid("brand", { channel_name: "Daily History" })).toBe(true);
    expect(stepAnswersValid("brand", { channel_name: "x" })).toBe(false);
  });

  it("welcome/connect/video always pass (validated by other means)", () => {
    expect(stepAnswersValid("welcome", {})).toBe(true);
    expect(stepAnswersValid("connect", {})).toBe(true);
    expect(stepAnswersValid("video", {})).toBe(true);
  });
});
