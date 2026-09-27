/**
 * Stream B — channel blueprints (F2).
 *
 * DETERMINISTIC and rule-based — no LLM in Phase 2 (D74 precedent: free,
 * instant, auditable). The blueprint is derived from the niche's keywords
 * plus medians of its tracked channels, persisted on niches.blueprint.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "../server-auth";
import { scoringInternals } from "./scoring";
import {
  getPort,
  type ChannelEvidence,
  type NicheDataPort,
  type NicheEnvelope,
  type NicheRow,
} from "./niches.functions";

const { median } = scoringInternals;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface BlueprintPillar {
  name: string;
  description: string;
  exampleTitles: string[];
}

export interface Blueprint {
  positioning: string;
  audience: string;
  pillars: BlueprintPillar[];
  formats: string[];
  cadence: { videosPerWeek: number; rationale: string };
  differentiators: string[];
  generatedAt: string;
  method: "rule-based";
}

export interface BlueprintStats {
  channelCount: number;
  medianSubs: number | null;
  medianGrowth7dPct: number | null;
  medianVideos: number | null;
}

const PILLAR_ANGLES = ["Explained", "Deep Dives", "Untold Stories", "Uncovered", "Decoded"];

const EXAMPLE_TITLE_TEMPLATES = [
  (kw: string) => `The ${kw} story nobody talks about`,
  (kw: string) => `What everyone gets wrong about ${kw}`,
  (kw: string) => `${kw}: the pattern behind the biggest moments`,
];

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase());
}

function formatSubs(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return `${Math.round(n)}`;
}

function formatLabel(format: string): string {
  if (format === "long") return "long-form";
  if (format === "short") return "short-form";
  return "long- and short-form";
}

/* ------------------------------------------------------------------ */
/* Pure builder (unit-testable, no I/O)                                 */
/* ------------------------------------------------------------------ */

export function buildBlueprintStats(evidence: ChannelEvidence[]): BlueprintStats {
  const subs = evidence
    .map((e) => e.subscriberCount)
    .filter((n): n is number => typeof n === "number" && n > 0);
  const growth = evidence
    .map((e) => e.growth7dPct)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  const vids = evidence
    .map((e) => e.videoCount)
    .filter((n): n is number => typeof n === "number" && n > 0);
  return {
    channelCount: evidence.length,
    medianSubs: median(subs),
    medianGrowth7dPct: median(growth),
    medianVideos: median(vids),
  };
}

/**
 * Build a blueprint deterministically from niche data + channel medians.
 * Same inputs → same blueprint, byte for byte (except generatedAt).
 */
export function buildBlueprint(
  niche: Pick<NicheRow, "name" | "keywords" | "preferred_format" | "preferred_language">,
  stats: BlueprintStats,
  now: Date = new Date(),
): Blueprint {
  const keywords = niche.keywords.filter(Boolean).slice(0, 5);
  const seedKeywords = keywords.length > 0 ? keywords : [niche.name];
  const kwList =
    seedKeywords.length > 1
      ? `${seedKeywords.slice(0, -1).join(", ")} and ${seedKeywords[seedKeywords.length - 1]}`
      : seedKeywords[0]!;

  const pillars: BlueprintPillar[] = seedKeywords.map((kw, i) => {
    const clean = kw.trim().toLowerCase();
    return {
      name: `${titleCase(clean)} ${PILLAR_ANGLES[i % PILLAR_ANGLES.length]}`,
      description:
        `A recurring series on ${clean} — each episode takes one question, event, or misconception ` +
        `and resolves it with cited evidence. Series beat one-offs for returning viewers.`,
      exampleTitles: EXAMPLE_TITLE_TEMPLATES.map((t) => t(clean)),
    };
  });

  const formats =
    niche.preferred_format === "long"
      ? [
          "Long-form explainers (8–15 min)",
          "Deep-dive documentaries (20+ min)",
          "Community polls to pick next topics",
        ]
      : niche.preferred_format === "short"
        ? [
            "Vertical shorts under 60 seconds",
            "60–90 second explainers",
            "One-question hook format",
          ]
        : [
            "Long-form explainers (8–15 min) as the flagship",
            "Shorts cut from each long episode for discovery",
            "Series playlists so shorts feed the long-form",
          ];

  const g = stats.medianGrowth7dPct;
  const videosPerWeek = g != null && g >= 5 ? 3 : g != null && g >= 1 ? 2 : 1;
  const cadence =
    videosPerWeek === 3
      ? "Tracked channels in this niche are growing fast (median ≥5%/week) — volume keeps you in the recommendation mix."
      : videosPerWeek === 2
        ? "The niche is moving at a moderate pace — two quality uploads a week beats daily filler."
        : "A slower niche rewards depth over volume — one strong upload a week, every week, compounds.";

  const band =
    stats.medianSubs != null
      ? `Competing in the ~${formatSubs(stats.medianSubs)} subscriber band (median of tracked channels)`
      : "No subscriber data yet — track channels to calibrate the competitive band";
  const differentiators = [
    band,
    "Cite sources on screen and in the description — most channels in this space don't, and it builds trust",
    "One clear question per video, answered in the first 30 seconds, then the evidence",
    "No on-screen text baked into AI-generated footage — add captions in the edit so nothing misspells",
  ];

  return {
    positioning:
      `A ${formatLabel(niche.preferred_format)} channel decoding ${kwList} — ` +
      `evidence-first, no hype, built for viewers who want answers, not noise.`,
    audience: `Curious viewers already searching for ${kwList}; secondary audience: casual scrollers pulled in by the shorts cutdowns.`,
    pillars,
    formats,
    cadence: { videosPerWeek, rationale: cadence },
    differentiators,
    generatedAt: now.toISOString(),
    method: "rule-based",
  };
}

export function isBlueprint(v: unknown): v is Blueprint {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Blueprint).positioning === "string" &&
    Array.isArray((v as Blueprint).pillars)
  );
}

/* ------------------------------------------------------------------ */
/* Business logic over the port                                        */
/* ------------------------------------------------------------------ */

export async function generateBlueprintForNiche(
  port: NicheDataPort,
  userId: string,
  nicheId: string,
  now: Date = new Date(),
): Promise<NicheEnvelope<{ blueprint: Blueprint }>> {
  const niche = await port.getNiche(userId, nicheId);
  if (!niche) throw new Error("Niche not found");
  const evidence = await port.getNicheChannelEvidence(userId, nicheId);
  if (evidence.length === 0) {
    return {
      status: "insufficient_data",
      reason:
        "A blueprint needs tracked channels to calibrate against. Track competitor channels for this niche first.",
    };
  }
  const blueprint = buildBlueprint(niche, buildBlueprintStats(evidence), now);
  await port.updateNiche(userId, nicheId, { blueprint });
  return { status: "ok", blueprint };
}

/* ------------------------------------------------------------------ */
/* Server functions                                                    */
/* ------------------------------------------------------------------ */

const nicheIdSchema = z.object({ nicheId: z.string().uuid() });

export const generateBlueprint = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => nicheIdSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    return generateBlueprintForNiche(await getPort(), userId, data.nicheId);
  });

export const getBlueprint = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => nicheIdSchema.parse(i))
  .handler(async ({ data, context }): Promise<NicheEnvelope<{ blueprint: Blueprint | null }>> => {
    const { userId } = context;
    const niche = await (await getPort()).getNiche(userId, data.nicheId);
    if (!niche) throw new Error("Niche not found");
    const blueprint = isBlueprint(niche.blueprint) ? niche.blueprint : null;
    return { status: "ok", blueprint };
  });
