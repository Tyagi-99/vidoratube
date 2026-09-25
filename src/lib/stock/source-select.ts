/**
 * Source selection for Cinema Mode (Sprint 5-6).
 *
 * The hard rule, in code: for every scene, visuals are picked by strict
 * priority —
 *   1. user-uploaded footage,
 *   2. licensed Pexels/Pixabay stock (provenance recorded),
 *   3. AI-generated hero shots (capped at AI_HERO_RUNTIME_CAP of runtime).
 *
 * - planSceneSources is PURE (no I/O): tier assignment + hero-cap
 *   enforcement. Unit-tested without network or database.
 * - resolveSceneSources is the async pipeline: plan, then attach real stock
 *   assets via the provider set (mock when no API keys — see stock/mock.ts),
 *   then re-apply the cap after stock→hero fallbacks.
 * - buildSourceProvenanceRows + recordSourceProvenance write one
 *   asset_provenance row per chosen asset (provider, license, license_url,
 *   asset_url / asset id, scene link).
 *
 * Hero-cap semantics: "trim" (default) scales each AI hero scene's billable
 * seconds down proportionally so the plan fits the cap and flags
 * heroTrimmed; the trimmed seconds are expected to be covered by stock or
 * stills in final assembly. "reject" throws HeroCapExceededError instead.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { recordProvenance, type ProvenanceRecord } from "../provenance";
import type { StockProvider } from "../providers/stock.server";
import { resolveStockProviders } from "./mock";
import type {
  SceneSourceDecision,
  SceneSourceTier,
  SourcePlan,
  SourceSceneInput,
} from "./types";

/** AI hero shots may cover at most 10% of finished runtime, by default. */
export const AI_HERO_RUNTIME_CAP = 0.1;

/** Cap enforcement policy: "trim" scales heroes down, "reject" throws. */
export type HeroCapPolicy = "trim" | "reject";

/** Thrown by planSceneSources when policy is "reject" and the cap is exceeded. */
export class HeroCapExceededError extends Error {
  readonly aiHeroSeconds: number;
  readonly capSeconds: number;
  constructor(aiHeroSeconds: number, capSeconds: number) {
    super(
      `AI hero shots cover ${Math.round(aiHeroSeconds)}s of runtime — ` +
        `over the ${(AI_HERO_RUNTIME_CAP * 100).toFixed(0)}% cap (${Math.floor(capSeconds)}s).`,
    );
    this.name = "HeroCapExceededError";
    this.aiHeroSeconds = aiHeroSeconds;
    this.capSeconds = capSeconds;
  }
}

/**
 * Tier for one scene, in strict SOURCE_PRIORITY order. User footage always
 * wins; stock eligibility needs queries or an explicit flag; everything
 * else is an AI hero candidate.
 */
export function tierForScene(scene: SourceSceneInput): SceneSourceTier {
  if (scene.userFootageUrl) return "user_upload";
  if ((scene.searchQueries?.length ?? 0) > 0 || scene.stockEligible) return "stock";
  return "ai_hero";
}

/**
 * Enforce the hero cap on a raw (pre-cap) hero-seconds number.
 * Pure — shared by the planner, the RenderPanel quote and the server
 * enqueue path so all three agree on the billable hero seconds.
 */
export function applyHeroCap(input: {
  aiHeroSeconds: number;
  totalSeconds: number;
  capRatio?: number;
}): { aiHeroSeconds: number; capSeconds: number; trimmed: boolean } {
  const ratio = input.capRatio ?? AI_HERO_RUNTIME_CAP;
  const total = Math.max(0, input.totalSeconds);
  const capSeconds = ratio * total;
  // Coerce: callers that bypass zod (unit-test fixtures) may pass undefined.
  const hero = Number.isFinite(input.aiHeroSeconds) ? Math.max(0, input.aiHeroSeconds as number) : 0;
  if (hero <= capSeconds) return { aiHeroSeconds: hero, capSeconds, trimmed: false };
  return { aiHeroSeconds: Math.floor(capSeconds), capSeconds, trimmed: true };
}

/**
 * Pure tier assignment + hero-cap enforcement for a scene list.
 * No I/O: stock assets are attached later by resolveStockForPlan.
 */
export function planSceneSources(
  scenes: SourceSceneInput[],
  opts?: { capRatio?: number; heroPolicy?: HeroCapPolicy },
): SourcePlan {
  const capRatio = opts?.capRatio ?? AI_HERO_RUNTIME_CAP;
  const heroPolicy: HeroCapPolicy = opts?.heroPolicy ?? "trim";

  const totalSeconds = scenes.reduce((s, sc) => s + Math.max(0, sc.durationSeconds), 0);
  const capSeconds = capRatio * Math.max(0, totalSeconds);

  const decisions: SceneSourceDecision[] = scenes.map((scene) => {
    const tier = tierForScene(scene);
    return {
      sceneId: scene.sceneId,
      tier,
      durationSeconds: Math.max(0, scene.durationSeconds),
      userFootageUrl: scene.userFootageUrl ?? null,
      searchQueries: [...(scene.searchQueries ?? [])],
      aiHeroSeconds: tier === "ai_hero" ? Math.max(0, scene.durationSeconds) : 0,
      stockAsset: null,
      mockAsset: false,
      heroTrimmed: false,
    };
  });

  const preCapHero = decisions.reduce((s, d) => s + d.aiHeroSeconds, 0);
  let heroTrimmed = false;
  let aiHeroSeconds = preCapHero;
  if (preCapHero > capSeconds) {
    if (heroPolicy === "reject") throw new HeroCapExceededError(preCapHero, capSeconds);
    // Trim: scale every hero scene proportionally so the plan fits the cap.
    const factor = capSeconds > 0 ? capSeconds / preCapHero : 0;
    for (const d of decisions) {
      if (d.tier === "ai_hero") {
        d.aiHeroSeconds = Math.floor(d.aiHeroSeconds * factor);
        d.heroTrimmed = true;
      }
    }
    heroTrimmed = true;
    aiHeroSeconds = decisions.reduce((s, d) => s + d.aiHeroSeconds, 0);
  }

  return {
    decisions,
    totalSeconds,
    aiHeroSeconds,
    heroCapSeconds: capSeconds,
    capRatio,
    heroPolicy,
    heroTrimmed,
    stockMock: false,
  };
}

/**
 * Attach stock assets to a plan, trying providers in priority order
 * (Pexels, then Pixabay, then mock when no keys are configured).
 *
 * A stock tier that finds no asset anywhere falls back to "ai_hero" and is
 * flagged (stockFallback) — the cap is then re-applied so the fallback
 * cannot silently bust the 10% budget.
 */
export async function resolveStockForPlan(
  plan: SourcePlan,
  opts?: { providers?: StockProvider[] },
): Promise<SourcePlan> {
  const resolved = opts?.providers
    ? { providers: opts.providers, mock: opts.providers.some((p) => p.id === "mock") }
    : resolveStockProviders();
  const { providers } = resolved;

  const decisions: SceneSourceDecision[] = plan.decisions.map((d) => ({ ...d }));
  for (const d of decisions) {    if (d.tier !== "stock" || d.stockAsset) continue;
    let hit: SceneSourceDecision["stockAsset"] = null;
    let mock = false;
    for (const provider of providers) {
      for (const query of d.searchQueries.slice(0, 3)) {
        try {
          const results = await provider.search(query, "video", 6);
          if (results.length > 0) {
            hit = results[0] ?? null;
            mock = provider.id === "mock";
            break;
          }
        } catch {
          // One failing provider/query never breaks the plan — try the next.
        }
      }
      if (hit) break;
    }
    if (hit) {
      d.stockAsset = hit;
      d.mockAsset = mock;
    } else {
      // No licensed stock anywhere → AI hero fallback, re-capped below.
      d.tier = "ai_hero";
      d.stockFallback = true;
      d.aiHeroSeconds = d.durationSeconds;
      d.searchQueries = [];
    }
  }

  // Re-apply the hero cap after fallbacks grew the hero pool.
  const replan = planSceneSources(
    decisions.map((d) => ({
      sceneId: d.sceneId,
      durationSeconds: d.durationSeconds,
      ...(d.userFootageUrl ? { userFootageUrl: d.userFootageUrl } : {}),
      searchQueries: d.searchQueries,
      stockEligible: d.tier === "stock",
    })),
    { capRatio: plan.capRatio, heroPolicy: plan.heroPolicy },
  );
  // Preserve the attached assets through the re-plan (same order).
  replan.decisions.forEach((rd, i) => {
    const orig = decisions[i]!;
    rd.stockAsset = orig.stockAsset;
    rd.mockAsset = orig.mockAsset;
    rd.stockFallback = orig.stockFallback;
    rd.userFootageUrl = orig.userFootageUrl;
  });
  replan.stockMock = resolved.mock;
  return replan;
}

/**
 * Full pipeline: plan tiers, attach stock, re-apply the cap.
 * Pure planning except the provider searches (real HTTP only when keys
 * are configured; mock otherwise — see stock/mock.ts).
 */
export async function resolveSceneSources(
  scenes: SourceSceneInput[],
  opts?: { providers?: StockProvider[]; capRatio?: number; heroPolicy?: HeroCapPolicy },
): Promise<SourcePlan> {
  return resolveStockForPlan(planSceneSources(scenes, opts), opts);
}

function kindFromUrl(url: string): "video" | "image" {
  return /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(url) ? "video" : "image";
}

/**
 * Build one asset_provenance insert per chosen asset in the plan:
 * provider, license, license_url, asset_url / asset id, scene link.
 *
 * AI hero decisions carry no concrete asset at plan time — their row is
 * written by the generation path (resolveSceneVisual) once the image
 * exists, so the row can carry the prompt and model. Pass generatedUrls
 * (sceneId -> asset URL) to also record already-generated heroes here.
 */
export function buildSourceProvenanceRows(
  plan: SourcePlan,
  input: {
    userId: string;
    projectId?: string | null;
    generatedHeroUrls?: Record<string, string>;
  },
): ProvenanceRecord[] {
  const rows: ProvenanceRecord[] = [];
  for (const d of plan.decisions) {
    const base = {
      userId: input.userId,
      projectId: input.projectId ?? null,
      sceneId: d.sceneId,
    };
    if (d.tier === "user_upload" && d.userFootageUrl) {
      rows.push({
        ...base,
        kind: kindFromUrl(d.userFootageUrl),
        provider: "user_upload",
        license: "User-owned footage",
        assetUrl: d.userFootageUrl,
      });
    } else if (d.tier === "stock" && d.stockAsset) {
      const a = d.stockAsset;
      rows.push({
        ...base,
        kind: a.kind === "video" ? "video" : "image",
        provider: a.provider,
        model: a.asset_id,
        license: a.license,
        licenseUrl: a.source_url,
        assetUrl: a.url,
      });
    } else if (d.tier === "ai_hero") {
      const url = input.generatedHeroUrls?.[d.sceneId];
      if (url) {
        rows.push({
          ...base,
          kind: "image",
          provider: "ai",
          license: "AI-generated hero shot",
          assetUrl: url,
        });
      }
    }
  }
  return rows;
}

/**
 * Write the plan's provenance rows to asset_provenance (service-role
 * client). Never throws — recordProvenance logs failures only.
 */
export async function recordSourceProvenance(
  supabase: SupabaseClient<Database>,
  plan: SourcePlan,
  input: { userId: string; projectId?: string | null; generatedHeroUrls?: Record<string, string> },
): Promise<void> {
  for (const row of buildSourceProvenanceRows(plan, input)) {
    await recordProvenance(supabase, row);
  }
}
