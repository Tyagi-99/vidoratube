/**
 * Stream A — F25 Idea → Campaign: pure campaign-plan builder.
 *
 * One idea fans out into a multi-format campaign. The plan is a list of
 * package items stored in `content_packages.metadata.items`; each item starts
 * `planned` and becomes `created` when a real artifact row is linked via
 * `linkCampaignItem` (script draft, title variants, thumbnail project,
 * shorts plan, metadata pack). No artifact is faked — `ref` is null until a
 * real row exists.
 *
 * Pure module — no I/O, no network, no randomness.
 */

export const CAMPAIGN_FORMATS = [
  "longform",
  "shorts",
  "thumbnail_set",
  "titles",
  "metadata",
] as const;
export type CampaignFormat = (typeof CAMPAIGN_FORMATS)[number];

export const CAMPAIGN_STATUSES = ["draft", "in_production", "ready"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** Forward-only status transitions for content_packages (Stream A scope). */
export const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ["in_production"],
  in_production: ["ready"],
  ready: [],
};

export interface CampaignItemRef {
  /** Which table the artifact lives in. */
  type: "script" | "title_variant" | "thumbnail_project" | "project";
  id: string;
}

export interface CampaignItem {
  /** Stable id within the package, e.g. "longform-script". */
  id: string;
  kind: "script_draft" | "title_variants" | "thumbnail_project" | "shorts_plan" | "metadata_pack";
  label: string;
  detail: string;
  status: "planned" | "created";
  /** Null until a real artifact row is linked — never fabricated. */
  ref: CampaignItemRef | null;
  dependsOn: string[];
}

export interface CampaignPlanInput {
  ideaId: string;
  ideaTitle: string;
  ideaHook: string;
  formats: CampaignFormat[];
  /** How many shorts the plan should sketch (default 3). */
  shortsCount?: number;
}

export interface CampaignPlan {
  name: string;
  formats: CampaignFormat[];
  items: CampaignItem[];
}

function validateFormats(formats: CampaignFormat[]): CampaignFormat[] {
  const valid = formats.filter((f): f is CampaignFormat =>
    (CAMPAIGN_FORMATS as readonly string[]).includes(f),
  );
  const deduped = [...new Set(valid)];
  if (deduped.length === 0) {
    throw new Error(
      `At least one format is required (choose from: ${CAMPAIGN_FORMATS.join(", ")})`,
    );
  }
  return deduped;
}

/**
 * Build the campaign plan for an idea. Deterministic: identical inputs →
 * identical items. Shorts beats are derived from the idea's own hook/angle
 * wording — labeled as drafts, never presented as produced assets.
 */
export function buildCampaignPlan(input: CampaignPlanInput): CampaignPlan {
  const formats = validateFormats(input.formats);
  const shortsCount = Math.max(1, Math.min(10, Math.floor(input.shortsCount ?? 3)));
  const items: CampaignItem[] = [];
  const title = input.ideaTitle.trim() || "Untitled idea";
  const hook = input.ideaHook.trim();

  if (formats.includes("longform")) {
    items.push({
      id: "longform-script",
      kind: "script_draft",
      label: "Long-form script draft",
      detail:
        `Full script for "${title}" — created in Script Studio (Stream B), bound to the selected brand voice.` +
        (hook ? ` Opening hook draft: "${hook}".` : ""),
      status: "planned",
      ref: null,
      dependsOn: [],
    });
  }

  if (formats.includes("shorts")) {
    const beats = Array.from({ length: shortsCount }, (_, i) => {
      const n = i + 1;
      const beat =
        i === 0 && hook
          ? `Hook cut: "${hook}"`
          : i === 0
            ? "Hook cut: lead with the idea's strongest claim"
            : `Beat ${n}: one self-contained moment from "${title}"`;
      return `${n}. ${beat}`;
    });
    items.push({
      id: "shorts-plan",
      kind: "shorts_plan",
      label: `Shorts plan (${shortsCount} cut${shortsCount === 1 ? "" : "s"})`,
      detail: `9:16 cutdowns sketched from the long-form draft:\n${beats.join("\n")}`,
      status: "planned",
      ref: null,
      dependsOn: formats.includes("longform") ? ["longform-script"] : [],
    });
  }

  if (formats.includes("thumbnail_set")) {
    items.push({
      id: "thumbnail-set",
      kind: "thumbnail_project",
      label: "Thumbnail set",
      detail: `3-variant thumbnail project for "${title}" — designed in Thumbnail Studio. Variants A/B/C feed the Phase-4 experiment arms.`,
      status: "planned",
      ref: null,
      dependsOn: formats.includes("titles") ? ["title-variants"] : [],
    });
  }

  if (formats.includes("titles")) {
    items.push({
      id: "title-variants",
      kind: "title_variants",
      label: "Title variants",
      detail: `Title Lab variants for "${title}" — scored with packaging heuristics (not CTR predictions); winners graduate to Phase-4 experiments.`,
      status: "planned",
      ref: null,
      dependsOn: [],
    });
  }

  if (formats.includes("metadata")) {
    items.push({
      id: "metadata-pack",
      kind: "metadata_pack",
      label: "Metadata pack",
      detail:
        "Description, tags, chapters, and pinned comment drafted from the script — filled in once the script draft exists.",
      status: "planned",
      ref: null,
      dependsOn: formats.includes("longform") ? ["longform-script"] : [],
    });
  }

  return {
    name: `${title} — campaign`,
    formats,
    items,
  };
}

/** Validate a campaign status transition; throws on illegal moves. */
export function assertCampaignTransition(from: string, to: string): asserts to is CampaignStatus {
  const allowed = CAMPAIGN_TRANSITIONS[from as CampaignStatus];
  if (!allowed || !(allowed as string[]).includes(to)) {
    throw new Error(`Illegal campaign transition: ${from} → ${to}`);
  }
}

/** Mark one item created with a real artifact ref; returns the updated items. */
export function linkCampaignItemRef(
  items: CampaignItem[],
  itemId: string,
  ref: CampaignItemRef,
): CampaignItem[] {
  const idx = items.findIndex((i) => i.id === itemId);
  if (idx === -1) throw new Error(`Unknown campaign item: ${itemId}`);
  return items.map((item, i) => (i === idx ? { ...item, status: "created" as const, ref } : item));
}
