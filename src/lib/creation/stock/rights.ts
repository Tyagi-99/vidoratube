/**
 * F18 Stock Media — per-asset rights tracking (Stream D, Phase 3).
 *
 * Every selected stock asset persists its license facts (provider, license,
 * attribution, URLs, fetch time) so a render can PROVE licensed use. The
 * canonical write sites:
 *
 *   - `content_assets.technical_metadata.rights` (the asset record)
 *   - `asset_provenance` (per-scene decision log — extends D48/D49)
 *   - `scenes.asset_source` (matches contracts.ts `SceneManifestScene.assetSource`
 *     shape: { kind: 'stock', provider, rights })
 *
 * Pure module — no DB, no network, no env. Unit-tested.
 */
import type { StockAsset } from "../../providers/stock.server";
import { MOCK_LICENSE } from "../../stock/mock";
import type { Json } from "@/integrations/supabase/types";

/** License facts every selected asset carries. */
export type StockRights = {
  provider: "pexels" | "pixabay" | "mock";
  assetId: string;
  kind: "photo" | "video";
  /** Verbatim license string from the provider (or the MOCK label). */
  license: string;
  /** Normalized license family for filtering/display. */
  licenseType: "pexels" | "pixabay" | "mock";
  /** True when the license legally REQUIRES attribution. */
  attributionRequired: boolean;
  /** True when attribution is requested but not legally required. */
  attributionRecommended: boolean;
  assetUrl: string;
  sourceUrl: string;
  creator: string;
  width: number;
  height: number;
  fetchedAt: string;
};

/** True for honestly-labeled preview assets that are NOT licensed for use. */
export function isMockAsset(asset: Pick<StockAsset, "provider" | "url" | "license">): boolean {
  return (
    asset.provider === "mock" || asset.url.startsWith("mock://") || asset.license === MOCK_LICENSE
  );
}

/**
 * Build the license-facts record for a selected asset. Mock assets keep
 * their honest label — they can never be recorded as licensed stock.
 */
export function buildStockRights(asset: StockAsset): StockRights {
  const mock = isMockAsset(asset);
  return {
    provider: asset.provider,
    assetId: asset.asset_id,
    kind: asset.kind,
    license: asset.license,
    licenseType: mock ? "mock" : asset.provider === "pexels" ? "pexels" : "pixabay",
    // Pexels/Pixabay licenses do not legally require attribution for
    // standard use; Pexels asks for it ("attribution appreciated").
    attributionRequired: false,
    attributionRecommended: !mock && asset.provider === "pexels",
    assetUrl: asset.url,
    sourceUrl: asset.source_url,
    creator: asset.creator,
    width: asset.width,
    height: asset.height,
    fetchedAt: asset.fetched_at,
  };
}

/** One-line human-readable license summary for the picker UI. */
export function licenseSummary(rights: StockRights): string {
  if (rights.licenseType === "mock") {
    return "MOCK — preview asset, not licensed for use";
  }
  const attribution = rights.attributionRequired
    ? "attribution required"
    : rights.attributionRecommended
      ? "attribution appreciated"
      : "no attribution required";
  const provider = rights.provider === "pexels" ? "Pexels" : "Pixabay";
  return `${provider} License · ${attribution} · by ${rights.creator}`;
}

/**
 * The `scenes.asset_source` jsonb shape for a stock pick — matches the
 * coordinator-owned contract: { kind: 'stock', provider, rights }.
 */
export function sceneAssetSourceForStock(rights: StockRights): Json {
  return { kind: "stock", provider: rights.provider, rights } as Json;
}

/**
 * The `content_assets` row insert for a selected stock asset. Callers must
 * supply a content_item_id the user owns (the table's FK is NOT NULL);
 * the rights facts live in `technical_metadata.rights` so renders can
 * prove licensed use from the asset row alone.
 */
export function toContentAssetInsert(input: {
  userId: string;
  contentItemId: string;
  rights: StockRights;
  sceneId?: string | undefined;
}): {
  user_id: string;
  content_item_id: string;
  kind: "source";
  origin: "stock";
  rights_basis: string;
  source_url: string;
  width: number;
  height: number;
  technical_metadata: Json;
} {
  return {
    user_id: input.userId,
    content_item_id: input.contentItemId,
    kind: "source",
    origin: "stock",
    rights_basis: input.rights.license,
    source_url: input.rights.assetUrl,
    width: input.rights.width,
    height: input.rights.height,
    technical_metadata: {
      rights: input.rights,
      ...(input.sceneId ? { scene_id: input.sceneId } : {}),
    } as Json,
  };
}

/** The `asset_provenance` row insert for a selected stock asset (D48/D49). */
export function toProvenanceInsert(input: {
  userId: string;
  projectId: string | null;
  sceneId: string;
  rights: StockRights;
}): {
  user_id: string;
  project_id: string | null;
  scene_id: string;
  kind: "image" | "video";
  provider: string;
  model: string;
  license: string;
  license_url: string;
  asset_url: string;
} {
  return {
    user_id: input.userId,
    project_id: input.projectId,
    scene_id: input.sceneId,
    kind: input.rights.kind === "video" ? "video" : "image",
    provider: input.rights.provider,
    model: input.rights.assetId,
    license: input.rights.license,
    license_url: input.rights.sourceUrl,
    asset_url: input.rights.assetUrl,
  };
}
