/**
 * Stream A — F25 Idea → Campaign server functions.
 *
 * One `video_ideas` row fans out into a `content_packages` row whose
 * `metadata.items` carry the linked artifacts (script draft ref, title
 * variants, thumbnail project ref, shorts plan) — each item starts
 * `planned` with `ref: null` and becomes `created` only when a real row is
 * linked via `linkCampaignItem`. Nothing is fabricated.
 *
 * Status flow: draft → in_production → ready (pinned transitions in
 * `campaigns.ts`).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "../../server-auth";
import { adminDb, dbList, dbOne, type AdminDb } from "../../intelligence/youtube-api.server";
import {
  assertCampaignTransition,
  buildCampaignPlan,
  CAMPAIGN_FORMATS,
  linkCampaignItemRef,
  type CampaignFormat,
  type CampaignItem,
  type CampaignItemRef,
  type CampaignStatus,
} from "./campaigns";

/* ------------------------------------------------------------------ */
/* Local table types (D89: `type` aliases, not interfaces)              */
/* ------------------------------------------------------------------ */

export type ContentPackageRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  idea_id: string | null;
  name: string;
  status: string;
  formats: string[];
  metadata: CampaignMetadata;
  created_at: string;
  updated_at: string;
};

/** Shape of content_packages.metadata written by Stream A (F25). */
export interface CampaignMetadata {
  stream: string;
  idea: { id: string; title: string; hook: string };
  items: CampaignItem[];
  created_via: string;
}

type VideoIdeaRow = {
  id: string;
  user_id: string;
  title: string;
  hook: string;
  angle: string;
  project_ref: string | null;
};

const PACKAGE_COLUMNS =
  "id, user_id, project_id, idea_id, name, status, formats, metadata, created_at, updated_at";

async function getAdmin(): Promise<AdminDb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return adminDb(supabaseAdmin);
}

/* ------------------------------------------------------------------ */
/* Pure helpers (exported for unit tests)                              */
/* ------------------------------------------------------------------ */

const itemRefSchema = z.object({
  type: z.enum(["script", "title_variant", "thumbnail_project", "project"]),
  id: z.string().uuid(),
});

export const createCampaignSchema = z.object({
  ideaId: z.string().uuid(),
  formats: z.array(z.enum(CAMPAIGN_FORMATS)).min(1).max(5),
  name: z.string().trim().min(1).max(120).optional(),
  shortsCount: z.number().int().min(1).max(10).default(3),
});

export const advanceCampaignSchema = z.object({
  campaignId: z.string().uuid(),
  to: z.enum(["draft", "in_production", "ready"]),
});

export const linkCampaignItemSchema = z.object({
  campaignId: z.string().uuid(),
  itemId: z.string().trim().min(1).max(60),
  ref: itemRefSchema,
});

const campaignIdSchema = z.object({ campaignId: z.string().uuid() });

/** Build the metadata payload stored on the content_packages row. */
export function buildPackageMetadata(
  idea: { id: string; title: string; hook: string },
  items: CampaignItem[],
): CampaignMetadata {
  return {
    stream: "phase3/stream-a",
    idea: { id: idea.id, title: idea.title, hook: idea.hook },
    items,
    created_via: "idea_to_campaign",
  };
}

async function ownCampaign(
  admin: AdminDb,
  userId: string,
  campaignId: string,
): Promise<ContentPackageRow | null> {
  return dbOne<ContentPackageRow>(
    admin
      .from("content_packages")
      .select(PACKAGE_COLUMNS)
      .eq("id", campaignId)
      .eq("user_id", userId)
      .maybeSingle<ContentPackageRow>(),
  );
}

/* ------------------------------------------------------------------ */
/* createCampaignFromIdea                                              */
/* ------------------------------------------------------------------ */

export const createCampaignFromIdea = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => createCampaignSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    const idea = await dbOne<VideoIdeaRow>(
      admin
        .from("video_ideas")
        .select("id, user_id, title, hook, angle, project_ref")
        .eq("id", data.ideaId)
        .eq("user_id", userId)
        .maybeSingle<VideoIdeaRow>(),
    );
    if (!idea) throw new Error("Idea not found.");
    const plan = buildCampaignPlan({
      ideaId: idea.id,
      ideaTitle: idea.title,
      ideaHook: idea.hook,
      formats: data.formats as CampaignFormat[],
      shortsCount: data.shortsCount,
    });
    const pkg = await dbOne<ContentPackageRow>(
      admin
        .from("content_packages")
        .insert({
          user_id: userId,
          project_id: idea.project_ref,
          idea_id: idea.id,
          name: data.name ?? plan.name,
          status: "draft",
          formats: plan.formats,
          metadata: buildPackageMetadata(idea, plan.items),
        })
        .select(PACKAGE_COLUMNS)
        .single<ContentPackageRow>(),
    );
    if (!pkg) throw new Error("Failed to create campaign.");
    return { status: "ok" as const, campaign: pkg };
  });

/* ------------------------------------------------------------------ */
/* listCampaigns / getCampaign                                         */
/* ------------------------------------------------------------------ */

export const listCampaigns = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({}).parse(i))
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    const campaigns = await dbList<ContentPackageRow>(
      admin
        .from("content_packages")
        .select(PACKAGE_COLUMNS)
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(100),
    );
    return { status: "ok" as const, campaigns };
  });

export const getCampaign = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => campaignIdSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    const campaign = await ownCampaign(admin, userId, data.campaignId);
    if (!campaign) throw new Error("Campaign not found.");
    return { status: "ok" as const, campaign };
  });

/* ------------------------------------------------------------------ */
/* advanceCampaign                                                     */
/* ------------------------------------------------------------------ */

export const advanceCampaign = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => advanceCampaignSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    const campaign = await ownCampaign(admin, userId, data.campaignId);
    if (!campaign) throw new Error("Campaign not found.");
    assertCampaignTransition(campaign.status, data.to);
    const updated = await dbOne<ContentPackageRow>(
      admin
        .from("content_packages")
        .update({ status: data.to, updated_at: new Date().toISOString() })
        .eq("id", campaign.id)
        .eq("user_id", userId)
        .select(PACKAGE_COLUMNS)
        .single<ContentPackageRow>(),
    );
    if (!updated) throw new Error("Failed to advance campaign.");
    return { status: "ok" as const, campaign: updated };
  });

/* ------------------------------------------------------------------ */
/* linkCampaignItem — attach a real artifact ref to a planned item     */
/* ------------------------------------------------------------------ */

export const linkCampaignItem = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => linkCampaignItemSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    const campaign = await ownCampaign(admin, userId, data.campaignId);
    if (!campaign) throw new Error("Campaign not found.");
    const items = campaign.metadata.items ?? [];
    const ref: CampaignItemRef = { type: data.ref.type, id: data.ref.id };
    const updatedItems = linkCampaignItemRef(items, data.itemId, ref);
    const updated = await dbOne<ContentPackageRow>(
      admin
        .from("content_packages")
        .update({
          metadata: { ...campaign.metadata, items: updatedItems },
          updated_at: new Date().toISOString(),
        })
        .eq("id", campaign.id)
        .eq("user_id", userId)
        .select(PACKAGE_COLUMNS)
        .single<ContentPackageRow>(),
    );
    if (!updated) throw new Error("Failed to link campaign item.");
    return { status: "ok" as const, campaign: updated };
  });

export type { CampaignStatus };
