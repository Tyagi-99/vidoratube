/**
 * Phase 6 Stream E (P3) — viral word vectors server function.
 *
 * Reads the user's own `outlier_videos` corpus (title + outlier_score) and
 * returns the deterministic word-vector envelope from `vectors.ts`. No
 * provider calls, no spend — this is computed from data the user already
 * imported via the Outlier Explorer (F4).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "../../server-auth";
import { adminDb, dbList, type AdminDb } from "../../intelligence/youtube-api.server";
import { intelDb } from "../../intelligence/outliers.functions";
import { buildVectorEnvelope, type VectorEnvelope } from "./vectors";

type OutlierVideoRow = {
  title: string | null;
  outlier_score: number | null;
};

const vectorQuerySchema = z.object({
  /** Minimum outlier score for a video to join the corpus (default 1.5). */
  minOutlier: z.number().min(1).max(100).default(1.5),
  /** Cap the corpus (deterministic: highest scores first). */
  maxVideos: z.number().int().min(10).max(500).default(200),
});

export const getTitleWordVectors = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => vectorQuerySchema.parse(i))
  .handler(async ({ data, context }): Promise<VectorEnvelope> => {
    const { userId } = context as { userId: string };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin: AdminDb = adminDb(supabaseAdmin);
    const rows = await dbList<OutlierVideoRow>(
      intelDb(admin)
        .from("outlier_videos")
        .select("title, outlier_score")
        .eq("user_id", userId)
        .not("title", "is", null)
        .not("outlier_score", "is", null)
        .order("outlier_score", { ascending: false })
        .limit(data.maxVideos),
    );
    const corpus = rows
      .filter(
        (r): r is { title: string; outlier_score: number } =>
          typeof r.title === "string" &&
          r.title.trim().length > 0 &&
          typeof r.outlier_score === "number" &&
          r.outlier_score >= data.minOutlier,
      )
      .map((r) => ({ title: r.title, outlierScore: r.outlier_score }));
    return buildVectorEnvelope(corpus);
  });
