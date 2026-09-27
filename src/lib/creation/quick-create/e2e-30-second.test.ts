/**
 * E2E_30_SECOND_CREATION — permanent, rerunnable 30-second quick-create scenario.
 *
 * Topic: "Why do airplane windows have a tiny hole?"
 *
 * This is the FREE path: every deterministic stage runs end-to-end and every
 * paid stage resolves to an honest skip (`skipped_unconfigured` /
 * `skipped_needs_spend_approval`) with the exact ESTIMATE-labeled cost of the
 * real call. No provider keys, no spend approval, no network — and no fake
 * renders: a stage is never marked complete unless its real work happened.
 *
 * Research (done 2026-09-28 via web search; claim wording verified against
 * the sources below — no fabricated facts):
 *   S1. https://gizmodo.com/why-is-there-a-hole-in-airplane-windows-1703660371
 *       (Marlowe Moncur, GKN Aerospace: the breather hole is a bleed valve
 *       that equilibrates pressure between the cabin and the gap between the
 *       outer and middle panes, so cabin pressure applies only to the outer pane)
 *   S2. https://scienceblog.com/k-theres-a-reason-every-aeroplane-window-has-a-tiny-hole-in-it-and-its-not-the-reason-most-people-assume/
 *       (middle pane sits unloaded as a backup; takes over if the outer pane fails)
 *   S3. https://www.familyhandyman.com/article/airplane-window-bleed-hole/
 *       (three acrylic layers; hole also reduces fogging between layers)
 *
 * Persistence note: DB writes (ideas, research_sources, research_claims,
 * scenes, captions, quick_create_runs, seo_packages) live in the server
 * functions (`quick-create.functions.ts`, `seo.functions.ts`); this scenario
 * exercises the same pure stage logic those functions call, plus the
 * dev-server walkthrough in docs/E2E_30_SECOND_CREATION.md covers the
 * persisted path.
 */
import { describe, expect, it } from "vitest";
import { scoreIdea } from "../ideas/scorer";
import { extractClaimCandidates, linkClaimsToSources } from "../claims/linker";
import { buildQuickScript } from "./script";
import { planQuickScenes, scenePlansToManifest } from "./scenes";
import { qcStudioTimeline } from "../video-studio/qc";
import { buildTimelineCaptions } from "./captions";
import { estimatePaidStageCredits, resolveMusicStage, resolvePaidStage } from "./pipeline";
import { buildSeoPackage } from "../seo/seo";
import { SceneManifestSchema } from "../contracts";

const TOPIC = "Why do airplane windows have a tiny hole?";
const PROJECT_ID = "e2e00000-0000-4000-8000-000000000001";

const SOURCES = [
  {
    id: "e2e00000-0000-4000-8000-000000000011",
    title: "Why Is There A Hole In Airplane Windows? (Gizmodo)",
    url: "https://gizmodo.com/why-is-there-a-hole-in-airplane-windows-1703660371",
    excerpt:
      "The breather hole near the bottom of the middle pane serves as a bleed valve, allowing pressure between the passenger cabin and the air between the outer and middle panes to equilibrate, so cabin pressure during flight is applied only to the outer pane.",
  },
  {
    id: "e2e00000-0000-4000-8000-000000000012",
    title: "There's a reason every aeroplane window has a tiny hole (scienceblog)",
    url: "https://scienceblog.com/k-theres-a-reason-every-aeroplane-window-has-a-tiny-hole-in-it-and-its-not-the-reason-most-people-assume/",
    excerpt:
      "The middle pane is a backup: it sits unloaded and undeteriorated, ready to take over the full pressure load if the outer pane ever fails.",
  },
  {
    id: "e2e00000-0000-4000-8000-000000000013",
    title: "What That Tiny Hole In Airplane Windows Is Actually For (Family Handyman)",
    url: "https://www.familyhandyman.com/article/airplane-window-bleed-hole/",
    excerpt:
      "The breather or bleed hole in the middle layer manages air pressure and reduces fogging between the window layers.",
  },
];

const FACTS = [
  "That tiny hole is called a breather — or bleed — hole, drilled through the middle pane of the window.",
  "It lets cabin air into the gap between the panes, so the outer pane bears the full pressure load.",
  "The middle pane stays unloaded — a pristine failsafe if the outer pane is ever damaged — and the slow airflow also stops fogging between the panes.",
];

const HOOK = "See that tiny hole at the bottom of your airplane window?";
const PAYOFF = "Follow for more surprising explanations.";

describe("E2E_30_SECOND_CREATION", () => {
  it("idea: scores deterministically (F8) without inventing data", () => {
    const score = scoreIdea({
      idea: {
        id: "idea-e2e",
        title: TOPIC,
        hook: HOOK,
        angle: "30-second explainer",
        format: "short",
        difficulty: "easy",
        safetyFlag: "safe",
      },
      outlier: { matchedOutlierScores: [], matchedKeywords: [], projectOutlierCount: 0 },
    });
    expect(score.total).toBeGreaterThanOrEqual(0);
    expect(score.total).toBeLessThanOrEqual(100);
    expect(score.factors.length).toBeGreaterThan(0);
    expect(["high", "medium", "low"]).toContain(score.confidence);
    // Honest verdict: the scorer disclaims virality prediction in its own words.
    expect(score.verdict).toMatch(/not a virality prediction/i);
    expect(score.verdict).not.toMatch(/guarantee/i);
  });

  it("research: ≥2 real sources, every claim linked to a source (F11)", () => {
    expect(SOURCES.length).toBeGreaterThanOrEqual(2);
    // Each verified fact is a claim candidate; F11 links them to sources.
    const candidates = FACTS.map((text) => ({ text }));
    expect(candidates.length).toBeGreaterThan(0);
    const linked = linkClaimsToSources(candidates, SOURCES);
    expect(linked.length).toBe(FACTS.length);
    for (const c of linked) {
      expect(c.matches.length).toBeGreaterThan(0);
      for (const m of c.matches) {
        expect(SOURCES.some((s) => s.id === m.sourceId)).toBe(true);
      }
    }
    // extractClaimCandidates also runs over the facts without inventing claims.
    const extracted = FACTS.flatMap((f) => extractClaimCandidates(f));
    expect(extracted.every((c) => FACTS.some((f) => f.includes(c.text.slice(0, 20))))).toBe(true);
  });

  it("script: 25–35s factual script from verified facts only", () => {
    const script = buildQuickScript({
      topic: TOPIC,
      hook: HOOK,
      facts: FACTS.map((text) => ({ text, sourceIds: [] })),
      payoff: PAYOFF,
    });
    expect(script.inTargetWindow).toBe(true);
    expect(script.durationSecEstimate).toBeGreaterThanOrEqual(25);
    expect(script.durationSecEstimate).toBeLessThanOrEqual(35);
    for (const f of FACTS) expect(script.fullText).toContain(f);
  });

  it("scenes: 5–7 narrated scenes → valid pinned SceneManifest (Stream E)", () => {
    const script = buildQuickScript({
      topic: TOPIC,
      hook: HOOK,
      facts: FACTS.map((text) => ({ text, sourceIds: [] })),
      payoff: PAYOFF,
    });
    const plans = planQuickScenes(script, TOPIC);
    expect(plans.length).toBeGreaterThanOrEqual(5);
    expect(plans.length).toBeLessThanOrEqual(7);
    const manifest = scenePlansToManifest(PROJECT_ID, plans);
    expect(SceneManifestSchema.safeParse(manifest).success).toBe(true);
    expect(manifest.scenes.every((s) => s.narration.length > 0)).toBe(true);
  });

  it("scene-level regeneration: one scene re-narrated, manifest stays valid", () => {
    const script = buildQuickScript({
      topic: TOPIC,
      hook: HOOK,
      facts: FACTS.map((text) => ({ text, sourceIds: [] })),
      payoff: PAYOFF,
    });
    const plans = planQuickScenes(script, TOPIC);
    const target = plans[2]!;
    const regen = plans.map((p) =>
      p.sceneNumber === target.sceneNumber
        ? {
            ...p,
            narration:
              "Engineers call it a breather hole — a tiny pressure valve in the middle pane.",
          }
        : p,
    );
    const manifest = scenePlansToManifest(PROJECT_ID, regen);
    expect(SceneManifestSchema.safeParse(manifest).success).toBe(true);
    expect(manifest.scenes).toHaveLength(plans.length);
    expect(manifest.scenes[2]!.narration).toContain("breather hole");
    expect(manifest.scenes[1]!.narration).toBe(plans[1]!.narration);
  });

  it("voiceover/visuals/render: honest skips — never faked as complete", () => {
    const script = buildQuickScript({
      topic: TOPIC,
      hook: HOOK,
      facts: FACTS.map((text) => ({ text, sourceIds: [] })),
      payoff: PAYOFF,
    });

    // No provider key → skipped_unconfigured.
    const noKey = resolvePaidStage({
      providerConfigured: false,
      spendApproved: false,
      costEstimateCredits: estimatePaidStageCredits("voiceover", {
        narrationText: script.fullText,
      }),
      providerName: "TTS provider",
    });
    expect(noKey.status).toBe("skipped_unconfigured");

    // Key present but no spend approval → skipped_needs_spend_approval + ESTIMATE.
    for (const stage of ["voiceover", "visuals", "render"] as const) {
      const cost = estimatePaidStageCredits(stage, {
        narrationText: script.fullText,
        sceneCount: 6,
        totalSec: script.durationSecEstimate,
      });
      const r = resolvePaidStage({
        providerConfigured: true,
        spendApproved: false,
        costEstimateCredits: cost,
        providerName: "provider",
      });
      expect(r.status).toBe("skipped_needs_spend_approval");
      expect(r.detail).toContain("ESTIMATE");
      expect(cost).not.toBeNull();
    }

    // Documented ESTIMATEs for the real render path (not run here).
    const renderEstimate = estimatePaidStageCredits("render", {
      totalSec: script.durationSecEstimate,
    });
    expect(renderEstimate).toBeGreaterThan(0);
  });

  it("assemble + QC: Stream E gate fails honestly without visuals, passes with them", () => {
    const script = buildQuickScript({
      topic: TOPIC,
      hook: HOOK,
      facts: FACTS.map((text) => ({ text, sourceIds: [] })),
      payoff: PAYOFF,
    });
    const plans = planQuickScenes(script, TOPIC);
    const toTimeline = (withVisuals: boolean) =>
      plans.map((p, i) => ({
        id: `scene-${i}`,
        number: p.sceneNumber,
        narration: p.narration,
        image: withVisuals ? `https://cdn.example/scene-${i}.png` : null,
        audio: null,
        duration: p.durationSecEstimate,
        cues: [],
      }));

    const withoutVisuals = qcStudioTimeline(toTimeline(false));
    expect(withoutVisuals.passed).toBe(false);
    expect(withoutVisuals.blocking).toContain("visuals_ready");

    const withVisuals = qcStudioTimeline(toTimeline(true));
    expect(withVisuals.passed).toBe(true);
    expect(withVisuals.blocking).toHaveLength(0);
  });

  it("captions: word/phrase-synced cues, ESTIMATE-labeled", () => {
    const script = buildQuickScript({
      topic: TOPIC,
      hook: HOOK,
      facts: FACTS.map((text) => ({ text, sourceIds: [] })),
      payoff: PAYOFF,
    });
    const plans = planQuickScenes(script, TOPIC);
    const timeline = buildTimelineCaptions(
      plans.map((p) => ({ sceneNumber: p.sceneNumber, narration: p.narration })),
    );
    expect(timeline.scenes).toHaveLength(plans.length);
    const spoken = timeline.scenes.map((s) => s.cues.map((c) => c.text).join(" ")).join(" ");
    expect(spoken).toBe(script.fullText);
    for (const s of timeline.scenes) {
      for (const cue of s.cues) expect(cue.timing).toBe("estimate");
    }
    expect(timeline.totalSecEstimate).toBeCloseTo(script.durationSecEstimate, 0);
  });

  it("music: honestly skipped_unconfigured without a music source", () => {
    const r = resolveMusicStage(null);
    expect(r.status).toBe("skipped_unconfigured");
  });

  it("SEO: titles + description + hashtags + 3 thumbnail concepts (F26)", () => {
    const pkg = buildSeoPackage({
      topic: TOPIC,
      title: "Why Do Airplane Windows Have a Tiny Hole?",
      facts: FACTS.slice(0, 2),
      sourceUrls: SOURCES.map((s) => s.url),
      maxHashtags: 12,
    });
    expect(pkg.titleOptions.length).toBeGreaterThan(0);
    expect(pkg.chosenTitle).toBe(pkg.titleOptions[0]!.title);
    expect(pkg.description).toContain(FACTS[0]);
    expect(pkg.description).toContain(SOURCES[0]!.url);
    expect(pkg.hashtags.length).toBeLessThanOrEqual(12);
    expect(pkg.thumbnailConcepts).toHaveLength(3);
  });

  it("stops at download: render is never marked done without spend approval", () => {
    // The pipeline's terminal honest state for render without approval is a
    // skip — there is no code path that marks it done or enqueues anything.
    const r = resolvePaidStage({
      providerConfigured: true,
      spendApproved: false,
      costEstimateCredits: estimatePaidStageCredits("render", { totalSec: 30 }),
      providerName: "Render provider",
    });
    expect(r.status).not.toBe("done");
    expect(r.status).toBe("skipped_needs_spend_approval");
  });
});
