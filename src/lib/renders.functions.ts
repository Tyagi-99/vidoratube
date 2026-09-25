import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "./server-auth";
import { looksLikeMp4Container, parseMp4Duration } from "./media/mp4";

/** Signed URLs are bearer tokens — keep them short-lived; refreshRenderUrl re-signs on demand. */
const SIGNED_URL_TTL = 60 * 60 * 24 * 7;

const BUCKET = "generated-videos";

/** Bytes fetched from the head of an upload for validation (moov/mvhd sit up front with faststart). */
const PROBE_BYTES = 262_144;

const idSchema = z.object({ id: z.string().uuid() });

export const listRenders = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ projectId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("renders")
      .select("*")
      .eq("project_id", data.projectId)
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const startRender = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        type: z.enum(["full", "scene", "preview"]).default("full"),
        aspect_ratio: z.string().max(10).default("16:9"),
        resolution: z.string().max(16).default("1920x1080"),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: project } = await context.supabase
      .from("projects")
      .select("id")
      .eq("id", data.projectId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!project) throw new Error("Project not found");

    const { data: row, error } = await context.supabase
      .from("renders")
      .insert({
        user_id: context.userId,
        project_id: data.projectId,
        type: data.type,
        engine: "browser_ffmpeg",
        format: "mp4",
        status: "running",
        stage: "init",
        progress: 0,
        aspect_ratio: data.aspect_ratio,
        resolution: data.resolution,
        render_started_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateRenderProgress = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) =>
    z
      .object({ id: z.string().uuid(), stage: z.string().max(40), progress: z.number().min(0).max(100) })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("renders")
      .update({ stage: data.stage, progress: Math.round(data.progress) })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Fetch just the head of a stored object over its signed URL (bounded memory —
 * the full file can be gigabytes). Returns the total object size when the
 * server honors Range, plus up to PROBE_BYTES of content for sniffing.
 */
async function probeStorageHead(url: string): Promise<{ totalBytes: number | null; head: Uint8Array }> {
  const res = await fetch(url, { headers: { Range: `bytes=0-${PROBE_BYTES - 1}` } });
  if (!res.ok || !res.body) {
    throw new Error(`Uploaded file is missing from storage (HTTP ${res.status}).`);
  }
  let totalBytes: number | null = null;
  const contentRange = res.headers.get("content-range"); // e.g. "bytes 0-262143/12345678"
  const total = contentRange?.split("/")[1];
  if (total && Number.isFinite(Number(total))) totalBytes = Number(total);

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let taken = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    taken += value.length;
    if (taken >= PROBE_BYTES) {
      await reader.cancel();
      break;
    }
  }
  const head = new Uint8Array(taken);
  let offset = 0;
  for (const chunk of chunks) {
    head.set(chunk, offset);
    offset += chunk.length;
  }
  return { totalBytes, head };
}

export const completeRender = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        path: z.string().max(400),
        file_size: z.number().int().nonnegative(),
        duration: z.number().nonnegative(),
        resolution: z.string().max(16),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Exact path match — the client uploads to <userId>/renders/<renderId>.mp4.
    const expectedPath = `${userId}/renders/${data.id}.mp4`;
    if (data.path !== expectedPath) throw new Error("Invalid upload path for this render");

    const { data: existing } = await supabase
      .from("renders")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!existing) throw new Error("Render not found");
    // Idempotent: a retried completion must not resurrect or double-process.
    if (existing.status === "completed") return existing;

    // Reject obviously bogus client claims before touching storage.
    if (!Number.isFinite(data.file_size) || data.file_size < 1024) {
      throw new Error("Rendered file is too small to be a valid MP4.");
    }
    if (!Number.isFinite(data.duration) || data.duration <= 0) {
      throw new Error("Rendered file has no playable duration.");
    }

    const { data: signed, error: signError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(data.path, SIGNED_URL_TTL);
    if (signError || !signed?.signedUrl) {
      throw new Error(signError?.message ?? "Could not sign result URL");
    }

    // Validate the stored object itself — never trust client file claims alone.
    const { totalBytes, head } = await probeStorageHead(signed.signedUrl);
    if (totalBytes !== null && totalBytes < 1024) {
      throw new Error("Uploaded video is empty or truncated.");
    }
    if (!looksLikeMp4Container(head)) {
      throw new Error("Uploaded file is not a valid MP4 (missing ftyp).");
    }
    // Prefer the server-probed duration over the client claim when parseable.
    const probed = parseMp4Duration(head);
    const duration =
      probed !== null && probed > 0 && probed < 86400 ? probed : data.duration;

    const { data: row, error } = await supabase
      .from("renders")
      .update({
        status: "completed",
        stage: "done",
        progress: 100,
        file_url: signed.signedUrl,
        file_size: totalBytes ?? data.file_size,
        duration,
        resolution: data.resolution,
        error: null,
        render_completed_at: new Date().toISOString(),
        meta: { path: data.path },
      })
      .eq("id", data.id)
      .eq("user_id", userId)
      .neq("status", "completed")
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    // Studio path: promote finished render URL onto the project when missing.
    if (row?.project_id && row.file_url) {
      await supabase
        .from("projects")
        .update({ result_url: row.file_url })
        .eq("id", row.project_id)
        .eq("user_id", userId)
        .is("result_url", null);
    }

    // "Close the tab" promise: record a notification row (always) and email
    // the user when a provider is configured. Fire-and-forget with a catch —
    // notification delivery must never fail a render completion.
    void (async () => {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { sendRenderCompleteEmail } = await import("./notifications.server");
        const { data: userData } = await supabase.auth.getUser();
        await sendRenderCompleteEmail(supabaseAdmin, {
          userId,
          userEmail: userData.user?.email ?? null,
          renderId: data.id,
          title: `Render ${data.id.slice(0, 8)}`,
          downloadPath: "/studio",
          durationSeconds: row?.duration ?? null,
        });
      } catch (e) {
        console.error("[completeRender] notification failed", data.id, e);
      }
    })();

    return row;
  });

export const failRender = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) =>
    z.object({ id: z.string().uuid(), error: z.string().max(1000), cancelled: z.boolean().default(false) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    // Never rewrite history: a completed render stays completed.
    const { error } = await context.supabase
      .from("renders")
      .update({
        status: data.cancelled ? "cancelled" : "failed",
        error: data.error.slice(0, 1000),
        render_completed_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .neq("status", "completed");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const refreshRenderUrl = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => idSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("renders")
      .select("meta")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    const path = (row?.meta as { path?: string } | null)?.path;
    if (!path) throw new Error("This render has no stored file");
    const { data: signed, error } = await context.supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL);
    if (error) throw new Error(error.message);
    await context.supabase
      .from("renders")
      .update({ file_url: signed?.signedUrl ?? null })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    return { url: signed?.signedUrl ?? null };
  });
