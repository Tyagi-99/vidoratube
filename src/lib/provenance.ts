/**
 * P4 asset provenance — records the origin of every generated asset.
 *
 * Every image, voiceover, music track, thumbnail, and video stores:
 * provider, model, prompt, seed, license, cost. The provenance drawer
 * shows "made with X, licensed Y"; downloads include provenance JSON.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type ProvenanceKind =
  | "image"
  | "voice"
  | "music"
  | "video"
  | "thumbnail"
  | "caption";

export interface ProvenanceRecord {
  userId: string;
  projectId?: string | null;
  sceneId?: string | null;
  kind: ProvenanceKind;
  provider: string;
  model?: string | null;
  prompt?: string | null;
  seed?: string | null;
  license?: string | null;
  licenseUrl?: string | null;
  costCredits?: number;
  assetUrl?: string | null;
}

/** Inserts a provenance row (service-role client). Never throws — logs only. */
export async function recordProvenance(
  supabase: SupabaseClient<Database>,
  rec: ProvenanceRecord
): Promise<void> {
  try {
    const { error } = await supabase.from("asset_provenance").insert({
      user_id: rec.userId,
      project_id: rec.projectId ?? null,
      scene_id: rec.sceneId ?? null,
      kind: rec.kind,
      provider: rec.provider,
      model: rec.model ?? null,
      prompt: rec.prompt ?? null,
      seed: rec.seed ?? null,
      license: rec.license ?? null,
      license_url: rec.licenseUrl ?? null,
      cost_credits: rec.costCredits ?? 0,
      asset_url: rec.assetUrl ?? null,
    } as never);
    if (error) console.error("[vidora] provenance insert failed:", error.message);
  } catch (e) {
    console.error("[vidora] provenance insert threw:", e);
  }
}

/** Human-readable one-liner for the drawer: "made with X, licensed Y". */
export function provenanceSummary(p: {
  provider: string;
  model?: string | null;
  license?: string | null;
}): string {
  const made = p.model ? `${p.provider} (${p.model})` : p.provider;
  return p.license ? `Made with ${made} · ${p.license}` : `Made with ${made}`;
}
