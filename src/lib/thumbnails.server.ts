import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * P5: server-side thumbnail image generation + storage.
 * Uses the Lovable AI gateway image model (same as scene images).
 */

const IMAGE_MODEL = "google/gemini-2.5-flash-image";
const BUCKET = "generated-videos";

function apiKey(): string {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI is not configured on this project.");
  return key;
}

/** Generates one thumbnail image, returns raw JPEG/PNG bytes. */
export async function requestThumbnailImage(
  prompt: string,
  /** Cost ctx: when provided, the image call's measured cost is recorded. */
  cost?: {
    admin: SupabaseClient<Database>;
    userId: string;
    projectId?: string | null | undefined;
  },
): Promise<Uint8Array> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      messages: [{ role: "user", content: prompt }],
      modalities: ["image", "text"],
    }),
  });
  if (!res.ok) {
    throw new Error(`Thumbnail generation failed (${res.status})`);
  }
  const payload = (await res.json()) as { data?: { b64_json?: string }[] };
  const b64 = payload.data?.[0]?.b64_json;
  if (!b64) throw new Error("Thumbnail generation returned no image.");
  if (cost) {
    // Gateway image generation: flat per-image estimate (see api-cost.ts).
    const { GATEWAY_IMAGE_USD_PER_IMAGE, recordApiCost } = await import("./api-cost");
    await recordApiCost(cost.admin, {
      userId: cost.userId,
      projectId: cost.projectId,
      provider: "lovable-ai",
      operation: "thumbnail",
      units: 1,
      unitCostUsd: GATEWAY_IMAGE_USD_PER_IMAGE,
      meta: { model: IMAGE_MODEL, cost_basis: "gateway-passthrough-estimate" },
    });
  }
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

/** Uploads thumbnail bytes to the private bucket, returns the storage path. */
export async function uploadThumbnail(
  admin: SupabaseClient<Database>,
  userId: string,
  projectId: string,
  variant: number,
  aspect: string,
  bytes: Uint8Array,
): Promise<string> {
  const safeAspect = aspect.replace(":", "x");
  const path = `${userId}/${projectId}/thumbnails/v${variant}-${safeAspect}.jpg`;
  const { error } = await admin.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error(`Thumbnail upload failed: ${error.message}`);
  return path;
}

/** Uploads the client-burned (overlay applied) final thumbnail. */
export async function uploadFinalThumbnail(
  admin: SupabaseClient<Database>,
  userId: string,
  projectId: string,
  variant: number,
  aspect: string,
  bytes: Uint8Array,
): Promise<string> {
  const safeAspect = aspect.replace(":", "x");
  const path = `${userId}/${projectId}/thumbnails/v${variant}-${safeAspect}-final.jpg`;
  const { error } = await admin.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error(`Thumbnail upload failed: ${error.message}`);
  return path;
}
