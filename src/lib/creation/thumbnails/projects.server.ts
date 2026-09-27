/**
 * F15 — thumbnail project server logic (Stream C).
 *
 * Design surface (`thumbnail_projects`, layered canvas) is separate from the
 * variant RENDER store (`public.thumbnails` — one row per project_id/variant/
 * aspect, per the table comment). Paid image generation runs through the
 * credit preflight gate first; without an image-provider key the module
 * returns the honest `image_provider_unconfigured` result — never a fake
 * generated image.
 *
 * SERVER-ONLY. `AdminDb` is structural (D89: generated types lack the Phase-1
 * tables, so local `type` aliases are used).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { activeImageProvider, generateImageWithTelemetry } from "@/lib/providers/image.server";
import { preflightCreditsCheck } from "@/lib/credits/preflight.server";
import type { PreflightInput, PreflightResult } from "@/lib/credits/preflight.server";
import type { ProviderResult } from "@/lib/providers/contracts";
import { hashThumbnailPrompt } from "@/lib/thumbnails.server";
import {
  CANVAS_DIMS,
  emptyCanvas,
  validateCanvasState,
  type CanvasAspect,
  type CanvasState,
} from "./canvas";
import type { StoragePort } from "../storage";

/** Minimal surface of the service-role client used by this module. */
export type AdminDb = Pick<SupabaseClient, "from">;

/* ── D89: local table-type aliases ───────────────────────────────────────── */

export type ThumbnailProjectRow = {
  id: string;
  user_id: string;
  project_id: string;
  name: string;
  /** Layered canvas state ({ layers, background }); validated on read. */
  canvas: CanvasState;
  width: number;
  height: number;
  status: string;
  created_at: string;
  updated_at: string;
};

/** Flat text-overlay spec as written by the studio (all-string wire type). */
export type ThumbnailOverlayWire = {
  headline?: string | undefined;
  font?: string | undefined;
  color?: string | undefined;
  position?: string | undefined;
  fontSize?: string | undefined;
};

export type ThumbnailRow = {
  id: string;
  user_id: string;
  project_id: string;
  variant: number;
  aspect: string;
  url: string;
  final_url: string | null;
  prompt: string | null;
  prompt_hash: string | null;
  is_ai_generated: boolean;
  provider: string | null;
  model: string | null;
  text_overlay: ThumbnailOverlayWire;
  selected: boolean | null;
  created_at: string;
};

export type ExperimentArmRow = {
  id: string;
  experiment_id: string;
  name: string;
  arm_type: string;
  thumbnail_id: string | null;
  created_at: string;
};

/* ── Result envelope ─────────────────────────────────────────────────────── */

export type ThumbOpResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

function fail<T>(code: string, message: string): ThumbOpResult<T> {
  return { ok: false, code, message };
}

/* ── Status flow ─────────────────────────────────────────────────────────── */

export const ThumbnailProjectStatusSchema = z.enum(["draft", "in_review", "approved"]);
export type ThumbnailProjectStatus = z.infer<typeof ThumbnailProjectStatusSchema>;

/** Allowed status transitions; `approved` is terminal. */
export const STATUS_TRANSITIONS: Record<ThumbnailProjectStatus, ThumbnailProjectStatus[]> = {
  draft: ["in_review"],
  in_review: ["draft", "approved"],
  approved: [],
};

/* ── Project CRUD ────────────────────────────────────────────────────────── */

export async function createThumbnailProject(
  admin: AdminDb,
  input: {
    userId: string;
    projectId: string;
    name?: string | undefined;
    aspect?: CanvasAspect | undefined;
  },
): Promise<ThumbOpResult<ThumbnailProjectRow>> {
  const { data: project, error: projectError } = await admin
    .from("projects")
    .select("id")
    .eq("id", input.projectId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (projectError) return fail("db_error", projectError.message);
  if (!project) return fail("project_not_found", "Project not found.");

  const dims = CANVAS_DIMS[input.aspect ?? "16:9"];
  const { data, error } = await admin
    .from("thumbnail_projects")
    .insert({
      user_id: input.userId,
      project_id: input.projectId,
      name: (input.name ?? "Thumbnail set").slice(0, 120),
      canvas: emptyCanvas(),
      width: dims.width,
      height: dims.height,
      status: "draft",
    })
    .select()
    .single();
  if (error) return fail("db_error", error.message);
  return { ok: true, data: data as ThumbnailProjectRow };
}

export type LoadedProject = {
  project: ThumbnailProjectRow;
  canvas: CanvasState;
  /** Structural problems in the stored canvas (empty = clean). */
  problems: string[];
};

/** Latest thumbnail project for a creation project, with its canvas validated. */
export async function getThumbnailProject(
  admin: AdminDb,
  input: { userId: string; projectId: string },
): Promise<ThumbOpResult<LoadedProject | null>> {
  const { data, error } = await admin
    .from("thumbnail_projects")
    .select("*")
    .eq("project_id", input.projectId)
    .eq("user_id", input.userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return fail("db_error", error.message);
  if (!data) return { ok: true, data: null };
  const row = data as ThumbnailProjectRow;
  const problems = validateCanvasState(row.canvas);
  return {
    ok: true,
    data: { project: row, canvas: problems.length > 0 ? emptyCanvas() : row.canvas, problems },
  };
}

/** Replace the project's canvas (validated first; invalid states are rejected). */
export async function updateThumbnailCanvas(
  admin: AdminDb,
  input: { userId: string; thumbnailProjectId: string; canvas: unknown },
): Promise<ThumbOpResult<ThumbnailProjectRow>> {
  const problems = validateCanvasState(input.canvas);
  if (problems.length > 0) {
    return fail("invalid_canvas", `Canvas rejected: ${problems.slice(0, 3).join("; ")}`);
  }
  const { data, error } = await admin
    .from("thumbnail_projects")
    .update({ canvas: input.canvas as Record<string, unknown> })
    .eq("id", input.thumbnailProjectId)
    .eq("user_id", input.userId)
    .select()
    .single();
  if (error) return fail("db_error", error.message);
  if (!data) return fail("not_found", "Thumbnail project not found.");
  return { ok: true, data: data as ThumbnailProjectRow };
}

/** Move a project through draft → in_review → approved (illegal jumps rejected). */
export async function setThumbnailProjectStatus(
  admin: AdminDb,
  input: { userId: string; thumbnailProjectId: string; status: ThumbnailProjectStatus },
): Promise<ThumbOpResult<ThumbnailProjectRow>> {
  const { data: current, error: readError } = await admin
    .from("thumbnail_projects")
    .select("id, status")
    .eq("id", input.thumbnailProjectId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (readError) return fail("db_error", readError.message);
  if (!current) return fail("not_found", "Thumbnail project not found.");

  const from = current.status as ThumbnailProjectStatus;
  const allowed = STATUS_TRANSITIONS[from] ?? [];
  if (!allowed.includes(input.status)) {
    return fail(
      "illegal_transition",
      `Cannot move a thumbnail project from "${from}" to "${input.status}".`,
    );
  }
  const { data, error } = await admin
    .from("thumbnail_projects")
    .update({ status: input.status })
    .eq("id", input.thumbnailProjectId)
    .eq("user_id", input.userId)
    .select()
    .single();
  if (error) return fail("db_error", error.message);
  return { ok: true, data: data as ThumbnailProjectRow };
}

/* ── Variant generation (paid path) ──────────────────────────────────────── */

export const IMAGE_MODEL = "google/gemini-2.5-flash-image";
export const IMAGE_PROVIDER_ID = "lovable-ai";

const VARIANT_ANGLES = [
  "extreme close-up of the subject, high emotion",
  "wide dramatic scene with strong leading lines",
  "split composition: before vs after",
  "minimalist bold composition, single focal object",
  "over-the-shoulder perspective, cinematic depth",
  "macro detail shot, textured background",
  "dynamic diagonal composition, motion energy",
  "contrasting colors, subject isolated on bold background",
];

function buildVariantPrompt(args: {
  videoTitle: string;
  videoTopic: string;
  styleHint?: string | undefined;
  variant: number;
  aspect: CanvasAspect;
}): string {
  const angle = VARIANT_ANGLES[(args.variant - 1) % VARIANT_ANGLES.length];
  return [
    `YouTube thumbnail background art for a video titled "${args.videoTitle}" about ${args.videoTopic}.`,
    `Composition: ${angle}.`,
    args.styleHint ? `Style: ${args.styleHint}.` : "",
    "Bold, high-contrast, cinematic lighting. No text, captions, watermarks or logos — text is layered separately in the editor.",
  ]
    .filter(Boolean)
    .join(" ");
}

export type GenerateVariantsInput = {
  userId: string;
  projectId: string;
  videoTitle: string;
  videoTopic: string;
  styleHint?: string | undefined;
  /** 1..8, default 4. */
  count?: number | undefined;
  aspect?: CanvasAspect | undefined;
};

export type GenerateVariantsDeps = {
  checkPreflight?:
    ((admin: AdminDb, input: PreflightInput) => Promise<PreflightResult>) | undefined;
  generateImage?:
    | ((req: { prompt: string; aspectRatio: string }) => Promise<ProviderResult<Uint8Array>>)
    | undefined;
  providerConfigured?: (() => boolean) | undefined;
};

export type GeneratedVariant = {
  variant: number;
  aspect: CanvasAspect;
  thumbnailId: string;
  storagePath: string;
};

/**
 * Generate N AI thumbnail variants via the image provider.
 *
 * Gate order: provider configured → project ownership → credit preflight →
 * generation → storage upload → `thumbnails` rows. Never throws: every
 * failure (unconfigured provider, denied preflight, provider error, storage
 * error) returns an `{ ok: false }` envelope with a machine-readable code.
 */
export async function generateThumbnailVariants(
  admin: AdminDb,
  storage: StoragePort,
  input: GenerateVariantsInput,
  deps: GenerateVariantsDeps = {},
): Promise<ThumbOpResult<GeneratedVariant[]>> {
  const count = Math.min(8, Math.max(1, Math.floor(input.count ?? 4)));
  const aspect: CanvasAspect = input.aspect ?? "16:9";

  const configured = (deps.providerConfigured ?? (() => activeImageProvider().configured()))();
  if (!configured) {
    return fail(
      "image_provider_unconfigured",
      "Image generation is not configured (no image-provider key). Connect an image provider before generating variants — Vidora will not fabricate thumbnails.",
    );
  }

  const { data: project, error: projectError } = await admin
    .from("projects")
    .select("id")
    .eq("id", input.projectId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (projectError) return fail("db_error", projectError.message);
  if (!project) return fail("project_not_found", "Project not found.");

  const checkPreflight =
    deps.checkPreflight ??
    ((a: AdminDb, i: PreflightInput) => preflightCreditsCheck(a as never, i));
  const preflight = await checkPreflight(admin, {
    userId: input.userId,
    projectId: input.projectId,
    jobType: "image",
    scenes: count,
    provider: "lovable-ai",
  });
  if (!preflight.ok) {
    return fail(preflight.code, preflight.message);
  }

  const generate = deps.generateImage ?? generateImageWithTelemetry;
  const safeAspect = aspect.replace(":", "x");
  const created: GeneratedVariant[] = [];

  for (let variant = 1; variant <= count; variant++) {
    const prompt = buildVariantPrompt({
      videoTitle: input.videoTitle,
      videoTopic: input.videoTopic,
      styleHint: input.styleHint,
      variant,
      aspect,
    });
    const result = await generate({ prompt, aspectRatio: aspect });
    if (!result.ok || !result.output) {
      return fail(
        result.status === "unconfigured" ? "image_provider_unconfigured" : "provider_error",
        result.error?.message ?? "Image generation failed.",
      );
    }
    const storagePath = `${input.userId}/${input.projectId}/thumbnails/proj-v${variant}-${safeAspect}.jpg`;
    try {
      await storage.uploadImage(storagePath, result.output, "image/jpeg");
    } catch (e) {
      return fail("storage_error", e instanceof Error ? e.message : "Thumbnail upload failed.");
    }
    const { data, error } = await admin
      .from("thumbnails")
      .upsert(
        {
          user_id: input.userId,
          project_id: input.projectId,
          variant,
          aspect,
          url: storagePath,
          prompt,
          prompt_hash: hashThumbnailPrompt(prompt),
          is_ai_generated: true,
          provider: IMAGE_PROVIDER_ID,
          model: IMAGE_MODEL,
          text_overlay: {},
          selected: false,
        },
        { onConflict: "project_id,variant,aspect" },
      )
      .select("id")
      .single();
    if (error || !data) {
      return fail("db_error", error?.message ?? "Could not record the thumbnail variant.");
    }
    created.push({ variant, aspect, thumbnailId: (data as { id: string }).id, storagePath });
  }

  return { ok: true, data: created };
}

/* ── Variant management ──────────────────────────────────────────────────── */

export type VariantView = ThumbnailRow & { viewUrl: string | null };

/** List variants for a project with signed view URLs (compare + select). */
export async function listProjectVariants(
  admin: AdminDb,
  storage: StoragePort,
  input: { userId: string; projectId: string },
): Promise<ThumbOpResult<VariantView[]>> {
  const { data, error } = await admin
    .from("thumbnails")
    .select(
      "id, user_id, project_id, variant, aspect, url, final_url, prompt, prompt_hash, is_ai_generated, provider, model, text_overlay, selected, created_at",
    )
    .eq("project_id", input.projectId)
    .eq("user_id", input.userId)
    .order("aspect")
    .order("variant");
  if (error) return fail("db_error", error.message);
  const rows = (data ?? []) as ThumbnailRow[];
  const views = await Promise.all(
    rows.map(async (row) => ({
      ...row,
      viewUrl: await storage.signImage((row.final_url ?? row.url) as string),
    })),
  );
  return { ok: true, data: views };
}

/**
 * Select the winning variant: clears `selected` for the same project+aspect,
 * then marks the winner. Writes to `thumbnails` (the canonical variant store).
 */
export async function selectVariantWinner(
  admin: AdminDb,
  input: { userId: string; thumbnailId: string },
): Promise<ThumbOpResult<ThumbnailRow>> {
  const { data: thumb, error: readError } = await admin
    .from("thumbnails")
    .select("id, project_id, aspect")
    .eq("id", input.thumbnailId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (readError) return fail("db_error", readError.message);
  if (!thumb) return fail("not_found", "Thumbnail variant not found.");
  const t = thumb as { id: string; project_id: string; aspect: string };

  const { error: clearError } = await admin
    .from("thumbnails")
    .update({ selected: false })
    .eq("project_id", t.project_id)
    .eq("aspect", t.aspect)
    .eq("user_id", input.userId);
  if (clearError) return fail("db_error", clearError.message);

  const { data, error } = await admin
    .from("thumbnails")
    .update({ selected: true })
    .eq("id", t.id)
    .select()
    .single();
  if (error) return fail("db_error", error.message);
  return { ok: true, data: data as ThumbnailRow };
}

/* ── Experiment linkage (Phase-4 packaging experiments; status flow only) ── */

export const ExperimentArmTypeSchema = z.enum(["control", "variant"]);
export type ExperimentArmType = z.infer<typeof ExperimentArmTypeSchema>;

/**
 * Attach a thumbnail variant as an arm of a packaging experiment. This records
 * the linkage only (experiment `status` flow + metrics live in Phase 4).
 */
export async function linkVariantToExperiment(
  admin: AdminDb,
  input: {
    userId: string;
    experimentId: string;
    thumbnailId: string;
    armName?: string | undefined;
    armType?: ExperimentArmType | undefined;
  },
): Promise<ThumbOpResult<ExperimentArmRow>> {
  const { data: experiment, error: expError } = await admin
    .from("experiments")
    .select("id")
    .eq("id", input.experimentId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (expError) return fail("db_error", expError.message);
  if (!experiment) return fail("experiment_not_found", "Experiment not found.");

  const { data: thumb, error: thumbError } = await admin
    .from("thumbnails")
    .select("id")
    .eq("id", input.thumbnailId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (thumbError) return fail("db_error", thumbError.message);
  if (!thumb) return fail("thumbnail_not_found", "Thumbnail variant not found.");

  const { data, error } = await admin
    .from("experiment_arms")
    .insert({
      experiment_id: input.experimentId,
      name: (input.armName ?? "Thumbnail arm").slice(0, 120),
      arm_type: input.armType ?? "variant",
      thumbnail_id: input.thumbnailId,
    })
    .select("id, experiment_id, name, arm_type, thumbnail_id, created_at")
    .single();
  if (error) return fail("db_error", error.message);
  return { ok: true, data: data as ExperimentArmRow };
}

/** Honest provider state for the UI: configured or not, never faked. */
export function imageProviderStatus(): { configured: boolean; label: string } {
  const provider = activeImageProvider();
  return { configured: provider.configured(), label: provider.label };
}
