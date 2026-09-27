/**
 * F18 Stock Media — server functions (Stream D, Phase 3).
 *
 * - `searchStock`: licensed-stock search through the key-gated providers.
 *   Without keys it returns the honest `configured: false` unavailable
 *   state with ZERO network calls (see search.server.ts).
 * - `selectStockAsset`: persists per-asset rights (content_assets +
 *   asset_provenance) and writes asset_url + asset_source into the scenes
 *   row, so renders can prove licensed use.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { StockAsset } from "../../providers/stock.server";
import { searchStockAssets, stockProviderStatus } from "./search.server";
import {
  buildStockRights,
  isMockAsset,
  sceneAssetSourceForStock,
  toContentAssetInsert,
  toProvenanceInsert,
} from "./rights";

export const getStockProviderStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => stockProviderStatus());

const searchStockSchema = z.object({
  query: z.string().min(1).max(200),
  kind: z.enum(["photo", "video"]).default("photo"),
  perPage: z.number().int().min(1).max(40).default(12),
  /**
   * Explicit opt-in to honestly-labeled MOCK preview assets (not licensed).
   * Defaults false: without provider keys the caller gets the honest
   * "not connected" state, never silent mock substitution.
   */
  includeMock: z.boolean().default(false),
});

export const searchStock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => searchStockSchema.parse(i))
  .handler(async ({ data }) => {
    return searchStockAssets(data.query, data.kind, {
      perPage: data.perPage,
      includeMock: data.includeMock,
    });
  });

const stockAssetSchema = z.object({
  provider: z.enum(["pexels", "pixabay", "mock"]),
  asset_id: z.string().min(1).max(200),
  kind: z.enum(["photo", "video"]),
  url: z.string().min(1).max(2000),
  thumb_url: z.string().max(2000).default(""),
  source_url: z.string().max(2000).default(""),
  creator: z.string().max(200).default(""),
  license: z.string().max(500).default(""),
  width: z.number().int().min(0).default(0),
  height: z.number().int().min(0).default(0),
  fetched_at: z.string().max(64).default(""),
});

const selectStockAssetSchema = z.object({
  sceneId: z.string().uuid(),
  asset: stockAssetSchema,
  /**
   * Optional content_item the user owns. When provided, a `content_assets`
   * row is written with the full rights record in technical_metadata;
   * provenance + scene asset_source are always written.
   */
  contentItemId: z.string().uuid().nullable().default(null),
});

/**
 * Select a stock asset for a scene. Writes:
 *   1. `asset_provenance` — the per-scene licensed-use decision log (D48/D49),
 *   2. `content_assets` (when contentItemId is given) — rights in
 *      technical_metadata.rights,
 *   3. `scenes.asset_url` + `scenes.asset_source` = { kind: 'stock', provider, rights }
 *      (coordinator contract shape in contracts.ts).
 *
 * Rights are rebuilt server-side from the submitted asset fields; the
 * caller never supplies pre-computed rights. Mock assets keep their honest
 * "not licensed" label and are flagged in the response.
 */
export const selectStockAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => selectStockAssetSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Scene ownership check first — nothing is written for someone else's scene.
    const { data: scene, error: sceneError } = await supabase
      .from("scenes")
      .select("id, project_id, user_id")
      .eq("id", data.sceneId)
      .eq("user_id", userId)
      .maybeSingle();
    if (sceneError) throw new Error(sceneError.message);
    if (!scene) throw new Error("Scene not found.");

    const asset: StockAsset = {
      ...data.asset,
      fetched_at: data.asset.fetched_at || new Date().toISOString(),
    };
    const rights = buildStockRights(asset);
    const mock = isMockAsset(asset);

    // 1. Provenance log (service-role; the table has no client INSERT policy).
    const { error: provError } = await supabaseAdmin.from("asset_provenance").insert(
      toProvenanceInsert({
        userId,
        projectId: scene.project_id ?? null,
        sceneId: scene.id,
        rights,
      }),
    );
    if (provError) throw new Error(`Could not record asset provenance: ${provError.message}`);

    // 2. content_assets row when a content item context is provided.
    if (data.contentItemId) {
      const { data: item, error: itemError } = await supabase
        .from("content_items")
        .select("id")
        .eq("id", data.contentItemId)
        .eq("user_id", userId)
        .maybeSingle();
      if (itemError) throw new Error(itemError.message);
      if (!item) throw new Error("Content item not found.");
      const { error: assetError } = await supabase
        .from("content_assets")
        .insert(
          toContentAssetInsert({ userId, contentItemId: item.id, rights, sceneId: scene.id }),
        );
      if (assetError) throw new Error(`Could not save the asset record: ${assetError.message}`);
    }

    // 3. Wire the pick into the scene row.
    const { error: sceneUpdateError } = await supabase
      .from("scenes")
      .update({
        asset_url: rights.assetUrl,
        asset_thumb_url: asset.thumb_url || null,
        asset_source: sceneAssetSourceForStock(rights),
      })
      .eq("id", scene.id)
      .eq("user_id", userId);
    if (sceneUpdateError)
      throw new Error(`Could not update the scene: ${sceneUpdateError.message}`);

    return {
      sceneId: scene.id,
      assetUrl: rights.assetUrl,
      rights,
      mock,
      mockWarning: mock
        ? "MOCK — preview asset, not licensed for use. It will not render in a licensed export."
        : null,
    };
  });
