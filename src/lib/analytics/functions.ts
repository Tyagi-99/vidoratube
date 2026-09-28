/**
 * Phase 4 · Stream B — server functions for F30/F31/F32/F33/F37/F38.
 *
 * All functions require an authenticated app user. Mutations/ingestion are
 * rate-limited. Nothing here fabricates metrics: OAuth-gated ingestion
 * returns an honest `ok:false` when credentials are absent.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "../server-auth";
import { aggregateBuckets, loadBucketVideos } from "./buckets";
import { loadRetentionDiagnoses } from "./retention";
import { loadChannelAudit } from "./audit";
import { loadDashboardData, ingestChannelSnapshot } from "./dashboard";
import { loadMonetization, saveMonetizationSettings } from "./monetization";
import { loadRoiReport } from "./roi";

const emptySchema = z.object({});

async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function rateLimit(admin: any, key: string, message: string) {
  const { enforcePostgresRateLimit } = await import("../rate-limit");
  await enforcePostgresRateLimit(admin, key, { max: 4, windowSeconds: 3600 }, message);
}

/* ------------------------------------------------------------------ */
/* F30 — dashboard + OAuth-gated ingestion                             */
/* ------------------------------------------------------------------ */

export const getAnalyticsDashboard = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => emptySchema.parse(i))
  .handler(async ({ context }) => {
    const admin = await adminClient();
    return loadDashboardData(admin, context.userId);
  });

export const ingestAnalyticsSnapshot = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => emptySchema.parse(i))
  .handler(async ({ context }) => {
    const admin = await adminClient();
    await rateLimit(
      admin,
      `analytics:ingest:${context.userId}`,
      "Analytics ingestion is limited to 4 times per hour.",
    );
    return ingestChannelSnapshot(admin, context.userId);
  });

/* ------------------------------------------------------------------ */
/* F31 — content buckets                                               */
/* ------------------------------------------------------------------ */

export const getContentBuckets = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => emptySchema.parse(i))
  .handler(async ({ context }) => {
    const admin = await adminClient();
    const videos = await loadBucketVideos(admin, context.userId);
    return { buckets: aggregateBuckets(videos), videoCount: videos.length };
  });

/* ------------------------------------------------------------------ */
/* F32 — scene-aware retention                                         */
/* ------------------------------------------------------------------ */

export const getRetentionDiagnoses = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => emptySchema.parse(i))
  .handler(async ({ context }) => {
    const admin = await adminClient();
    return { videos: await loadRetentionDiagnoses(admin, context.userId) };
  });

/* ------------------------------------------------------------------ */
/* F33 — channel audit                                                 */
/* ------------------------------------------------------------------ */

export const getChannelAudit = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => emptySchema.parse(i))
  .handler(async ({ context }) => {
    const admin = await adminClient();
    return loadChannelAudit(admin, context.userId);
  });

/* ------------------------------------------------------------------ */
/* F37 — monetization                                                  */
/* ------------------------------------------------------------------ */

export const getMonetizationSummary = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => emptySchema.parse(i))
  .handler(async ({ context }) => {
    const admin = await adminClient();
    return loadMonetization(admin, context.userId);
  });

export const rpmSchema = z.object({
  rpmEstimateUsd: z.number().min(0).max(1000).nullable(),
  cpmEstimateUsd: z.number().min(0).max(1000).nullable(),
});

export const setMonetizationSettings = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => rpmSchema.parse(i))
  .handler(async ({ data, context }) => {
    const admin = await adminClient();
    await rateLimit(
      admin,
      `analytics:rpm:${context.userId}`,
      "Monetization settings can be updated 4 times per hour.",
    );
    return saveMonetizationSettings(admin, context.userId, data);
  });

/* ------------------------------------------------------------------ */
/* F38 — ROI                                                           */
/* ------------------------------------------------------------------ */

export const getRoiReport = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => emptySchema.parse(i))
  .handler(async ({ context }) => {
    const admin = await adminClient();
    return loadRoiReport(admin, context.userId);
  });
