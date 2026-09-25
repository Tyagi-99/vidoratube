import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "./server-auth";
import {
  estimateQuotaUnits,
  median,
  outlierScore,
  parseChannelInput,
  parseYouTubeVideoId,
  titlePatternStats,
} from "./outliers";

/**
 * Research / Idea Engine (P3) — top-of-funnel: niche discovery → outlier
 * analysis → idea generation → script brief handoff.
 *
 * Billing: each LLM generation debits 1 credit via the idempotent
 * debit_credits_for_job_once RPC (a fresh UUID per generation is the ref).
 * Rate limit: 20 generations/hour per user (Postgres-backed, fails open).
 * YouTube Data API: 24h cache in youtube_api_cache; quota estimated up front.
 */

const LLM_MODEL = "google/gemini-3.5-flash";
const CACHE_TTL_SECONDS = 24 * 3600;

const NicheSchema = z.object({
  name: z.string(),
  description: z.string(),
  audience: z.string(),
  content_pillars: z.array(z.string()),
  advertiser_safety: z.enum(["safe", "caution", "risky"]),
  competition: z.enum(["low", "medium", "high"]),
});

const IdeaSchema = z.object({
  title: z.string().max(120),
  hook: z.string().max(300),
  angle: z.string().max(500),
  format: z.enum(["short", "long"]),
  difficulty: z.enum(["easy", "medium", "hard"]),
  safety_flag: z.enum(["safe", "caution", "risky"]),
});

async function enforceResearchRateLimit(userId: string, action: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { enforcePostgresRateLimit } = await import("./rate-limit");
  await enforcePostgresRateLimit(
    supabaseAdmin,
    `research:${action}:${userId}`,
    { max: 20, windowSeconds: 3600 },
    "You're researching too fast. Please wait a bit and try again.",
  );
}

async function debitResearchCredit(userId: string, reason: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { debitOneCreditForProject, OUT_OF_CREDITS_MESSAGE } = await import("./credits");
  const { randomUUID } = await import("node:crypto");
  try {
    await debitOneCreditForProject(supabaseAdmin, userId, randomUUID(), reason);
  } catch (e) {
    if (e instanceof Error && e.message === OUT_OF_CREDITS_MESSAGE) throw e;
    throw new Error(e instanceof Error ? e.message : "Credit debit failed");
  }
}

/** Call the Lovable AI gateway and parse a JSON array/object from the reply. */
async function llmJson<T>(system: string, user: string): Promise<T> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("AI is not configured on this project.");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: "system", content: system + "\nRespond with JSON only. No markdown fences." },
        { role: "user", content: user },
      ],
      temperature: 0.7,
    }),
  });
  if (!res.ok) throw new Error(`AI request failed (${res.status})`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content ?? "";
  const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  return JSON.parse(cleaned) as T;
}

/* ------------------------------- projects ------------------------------- */

export const listResearchProjects = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("research_projects")
      .select("id,topic,language,status,created_at,updated_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getResearchProject = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: project, error } = await context.supabase
      .from("research_projects")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!project) throw new Error("Research project not found");
    return project;
  });

const CreateProjectSchema = z.object({
  topic: z.string().trim().min(3).max(200),
  language: z.string().max(30).default("English"),
});

/** Explore a topic: LLM generates sub-niches, personas, pillars, safety fit. */
export const createResearchProject = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => CreateProjectSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId, supabase } = context;
    await enforceResearchRateLimit(userId, "niche");
    await debitResearchCredit(userId, "research: niche exploration");

    const niches = await llmJson<z.infer<typeof NicheSchema>[]>(
      `You are a YouTube strategist. Given a broad topic, return 5-7 sub-niches as a JSON array with fields: name, description (1-2 sentences), audience (who watches), content_pillars (3-4 pillar topics), advertiser_safety (safe|caution|risky — is this niche friendly to YouTube ads?), competition (low|medium|high).`,
      `Topic: ${data.topic}\nLanguage: ${data.language}`,
    );
    const parsed = z.array(NicheSchema).parse(niches);

    const { data: row, error } = await supabase
      .from("research_projects")
      .insert({
        user_id: userId,
        topic: data.topic,
        language: data.language,
        niches: parsed,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

/* ------------------------- YouTube Data API layer ------------------------- */

interface YtVideoStats {
  id: string;
  title: string;
  channelId: string;
  channelTitle: string;
  viewCount: number;
  publishedAt: string | null;
}

interface YtChannelStats {
  id: string;
  title: string;
  subscriberCount: number;
  videoCount: number;
}

async function getYouTubeAccessToken(userId: string): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { getValidAccessToken } = await import("./youtube.server");
  const { data: connection } = await supabaseAdmin
    .from("youtube_connections")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (!connection) throw new Error("Connect your YouTube channel first (Settings → Integrations).");
  const { accessToken, refreshed } = await getValidAccessToken(connection);
  if (refreshed?.access_token) {
    const { encryptToken } = await import("./youtube.server");
    await supabaseAdmin
      .from("youtube_connections")
      .update({
        access_token: await encryptToken(refreshed.access_token),
        expires_at: new Date(Date.now() + (refreshed.expires_in ?? 3500) * 1000).toISOString(),
      })
      .eq("user_id", userId);
  }
  return accessToken;
}

async function cachedYtFetch<T>(
  supabaseAdmin: import("@supabase/supabase-js").SupabaseClient,
  userId: string,
  cacheKey: string,
  fetcher: () => Promise<T>,
): Promise<{ data: T; cached: boolean }> {
  const { data: hit } = await supabaseAdmin
    .from("youtube_api_cache")
    .select("payload, expires_at")
    .eq("cache_key", cacheKey)
    .eq("user_id", userId)
    .maybeSingle();
  if (hit && Date.parse(hit.expires_at) > Date.now()) {
    return { data: hit.payload as T, cached: true };
  }
  const data = await fetcher();
  await supabaseAdmin.from("youtube_api_cache").upsert(
    {
      cache_key: cacheKey,
      user_id: userId,
      payload: JSON.parse(JSON.stringify(data)) as Record<string, unknown>,
      expires_at: new Date(Date.now() + CACHE_TTL_SECONDS * 1000).toISOString(),
    },
    { onConflict: "cache_key" },
  );
  return { data, cached: false };
}

async function ytApi<T>(accessToken: string, path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("YouTube denied the request — please reconnect your channel.");
  }
  if (!res.ok) throw new Error(`YouTube API error (${res.status})`);
  return (await res.json()) as T;
}

async function fetchVideoStats(
  accessToken: string,
  supabaseAdmin: import("@supabase/supabase-js").SupabaseClient,
  userId: string,
  videoIds: string[],
): Promise<{ videos: YtVideoStats[]; cached: number }> {
  const videos: YtVideoStats[] = [];
  let cached = 0;
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const key = `videos:${[...batch].sort().join(",")}`;
    const { data, cached: wasCached } = await cachedYtFetch<{ items: any[] }>(
      supabaseAdmin,
      userId,
      key,
      () =>
        ytApi(accessToken, "videos", {
          part: "snippet,statistics",
          id: batch.join(","),
        }),
    );
    if (wasCached) cached++;
    for (const item of data.items ?? []) {
      videos.push({
        id: item.id,
        title: item.snippet?.title ?? "",
        channelId: item.snippet?.channelId ?? "",
        channelTitle: item.snippet?.channelTitle ?? "",
        viewCount: Number(item.statistics?.viewCount ?? 0),
        publishedAt: item.snippet?.publishedAt ?? null,
      });
    }
  }
  return { videos, cached };
}

async function fetchChannelStats(
  accessToken: string,
  supabaseAdmin: import("@supabase/supabase-js").SupabaseClient,
  userId: string,
  channelIds: string[],
): Promise<Map<string, YtChannelStats>> {
  const map = new Map<string, YtChannelStats>();
  for (let i = 0; i < channelIds.length; i += 50) {
    const batch = channelIds.slice(i, i + 50);
    const key = `channels:${[...batch].sort().join(",")}`;
    const { data } = await cachedYtFetch<{ items: any[] }>(
      supabaseAdmin,
      userId,
      key,
      () =>
        ytApi(accessToken, "channels", {
          part: "snippet,statistics",
          id: batch.join(","),
        }),
    );
    for (const item of data.items ?? []) {
      map.set(item.id, {
        id: item.id,
        title: item.snippet?.title ?? "",
        subscriberCount: Number(item.statistics?.subscriberCount ?? 0),
        videoCount: Number(item.statistics?.videoCount ?? 0),
      });
    }
  }
  return map;
}

/** Resolve a channel handle or URL to a channel ID via the Data API. */
async function resolveChannelId(
  accessToken: string,
  supabaseAdmin: import("@supabase/supabase-js").SupabaseClient,
  userId: string,
  input: Exclude<ReturnType<typeof parseChannelInput>, null>,
): Promise<string> {
  if (input.kind === "channel_id") return input.value;
  const key = `resolve:${input.kind}:${input.value}`;
  const { data } = await cachedYtFetch<{ items: { id?: string; snippet?: { channelId?: string } }[] }>(
    supabaseAdmin,
    userId,
    key,
    async () => {
      if (input.kind === "handle") {
        return ytApi(accessToken, "channels", {
          part: "id",
          forHandle: input.value,
        });
      }
      // URL: try oEmbed-style extraction first, else search-less fallback fails
      const m = input.value.match(/youtube\.com\/(?:@([^/?#]+)|channel\/([A-Za-z0-9_-]+)|c\/([^/?#]+)|user\/([^/?#]+))/);
      const handle = m?.[1] ? `@${m[1]}` : null;
      if (m?.[2]) return { items: [{ id: m[2] }] };
      if (handle) {
        return ytApi(accessToken, "channels", { part: "id", forHandle: handle });
      }
      throw new Error("Could not parse that channel URL. Try a channel ID (UC…) or @handle.");
    },
  );
  const id = data.items?.[0]?.id ?? data.items?.[0]?.snippet?.channelId;
  if (!id) throw new Error("Channel not found.");
  return id;
}

/** Recent uploads for a channel (playlistItems on the uploads playlist). */
async function fetchChannelRecentVideos(
  accessToken: string,
  channelId: string,
  maxResults: number,
): Promise<string[]> {
  // Get the uploads playlist id
  const channel = await ytApi<{ items: { contentDetails: { relatedPlaylists: { uploads: string } } }[] }>(
    accessToken,
    "channels",
    { part: "contentDetails", id: channelId },
  );
  const playlistId = channel.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!playlistId) throw new Error("Could not read that channel's uploads.");
  const items = await ytApi<{ items: { contentDetails: { videoId: string } }[] }>(
    accessToken,
    "playlistItems",
    { part: "contentDetails", playlistId, maxResults: String(Math.min(50, maxResults)) },
  );
  return (items.items ?? []).map((i) => i.contentDetails.videoId).filter(Boolean);
}

/* ------------------------------- outliers ------------------------------- */

const ImportOutliersSchema = z.object({
  projectId: z.string().uuid(),
  /** YouTube video URLs (or bare IDs), and/or one channel input. */
  videoUrls: z.array(z.string().max(500)).max(30).default([]),
  channelInput: z.string().max(500).optional(),
  /** How many recent channel videos to pull when a channel is given. */
  channelVideoLimit: z.number().int().min(1).max(50).default(20),
});

export const importOutliers = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => ImportOutliersSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId, supabase } = context;
    await enforceResearchRateLimit(userId, "outliers");

    const { data: project } = await supabase
      .from("research_projects")
      .select("id")
      .eq("id", data.projectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!project) throw new Error("Research project not found");

    const videoIds = new Set<string>();
    for (const u of data.videoUrls) {
      const id = parseYouTubeVideoId(u);
      if (id) videoIds.add(id);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const accessToken = await getYouTubeAccessToken(userId);

    if (data.channelInput) {
      const parsed = parseChannelInput(data.channelInput);
      if (!parsed) throw new Error("Could not understand that channel input.");
      const channelId = await resolveChannelId(accessToken, supabaseAdmin, userId, parsed);
      const recent = await fetchChannelRecentVideos(accessToken, channelId, data.channelVideoLimit);
      for (const id of recent) videoIds.add(id);
    }

    if (videoIds.size === 0) throw new Error("No valid YouTube videos found in your input.");
    const ids = [...videoIds];

    const { videos } = await fetchVideoStats(accessToken, supabaseAdmin, userId, ids);
    if (videos.length === 0) throw new Error("YouTube returned no video data.");

    // Channel medians: group views per channel, median each.
    const viewsByChannel = new Map<string, number[]>();
    for (const v of videos) {
      const arr = viewsByChannel.get(v.channelId) ?? [];
      arr.push(v.viewCount);
      viewsByChannel.set(v.channelId, arr);
    }
    const channelStats = await fetchChannelStats(
      accessToken,
      supabaseAdmin,
      userId,
      [...viewsByChannel.keys()],
    );

    const rows = videos.map((v) => {
      const med = median(viewsByChannel.get(v.channelId) ?? []);
      return {
        user_id: userId,
        project_id: data.projectId,
        youtube_id: v.id,
        title: v.title,
        channel_id: v.channelId,
        channel_title: v.channelTitle,
        channel_subs: channelStats.get(v.channelId)?.subscriberCount ?? 0,
        view_count: v.viewCount,
        published_at: v.publishedAt,
        outlier_score: Math.round(outlierScore(v.viewCount, med) * 100) / 100,
        patterns: {
          title_stats: titlePatternStats([v.title]),
        },
      };
    });

    const { error } = await supabaseAdmin.from("outlier_videos").upsert(rows, {
      onConflict: "project_id,youtube_id",
    });
    if (error) throw new Error(error.message);

    const quotaUnits = estimateQuotaUnits(ids.length, viewsByChannel.size);
    return {
      imported: rows.length,
      quotaUnits,
      topOutlier: rows.sort((a, b) => b.outlier_score - a.outlier_score)[0] ?? null,
    };
  });

export const listOutliers = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ projectId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("outlier_videos")
      .select("*")
      .eq("project_id", data.projectId)
      .eq("user_id", context.userId)
      .order("outlier_score", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/* -------------------------------- ideas -------------------------------- */

const GenerateIdeasSchema = z.object({
  projectId: z.string().uuid(),
  nicheName: z.string().max(200).optional(),
  count: z.number().int().min(1).max(10).default(5),
});

export const listIdeas = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        status: z.enum(["new", "saved", "dismissed", "used"]).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("video_ideas")
      .select("*")
      .eq("project_id", data.projectId)
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** Generate video ideas from a niche + the project's outlier patterns. */
export const generateIdeas = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => GenerateIdeasSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId, supabase } = context;
    await enforceResearchRateLimit(userId, "ideas");
    await debitResearchCredit(userId, "research: idea generation");

    const { data: project } = await supabase
      .from("research_projects")
      .select("id,topic,language,niches")
      .eq("id", data.projectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!project) throw new Error("Research project not found");

    // Feed the LLM the top outlier patterns as "what's working".
    const { data: outliers } = await supabase
      .from("outlier_videos")
      .select("title,outlier_score,channel_title")
      .eq("project_id", data.projectId)
      .eq("user_id", userId)
      .order("outlier_score", { ascending: false })
      .limit(10);

    // P8 learning loop: the user's own channel winners (source='own') are
    // boosted into idea generation across every project.
    const { data: ownWinners } = await supabase
      .from("outlier_videos")
      .select("title,outlier_score")
      .eq("user_id", userId)
      .eq("source", "own")
      .order("outlier_score", { ascending: false })
      .limit(5);
    const ownWinnersCtx =
      ownWinners && ownWinners.length > 0
        ? `The creator's OWN best-performing videos (learn from what already worked for them):\n${ownWinners
            .map((o) => `- "${o.title}" | ${o.outlier_score}x their channel median`)
            .join("\n")}\n`
        : "";

    const nicheCtx = data.nicheName
      ? `Focus niche: ${data.nicheName}`
      : `Topic: ${project.topic}`;
    const outlierCtx =
      outliers && outliers.length > 0
        ? `Outperforming videos to learn from (title | score | channel):\n${outliers
            .map((o) => `- "${o.title}" | ${o.outlier_score}x | ${o.channel_title}`)
            .join("\n")}`
        : "No outlier data yet — generate original ideas.";

    const ideas = await llmJson<z.infer<typeof IdeaSchema>[]>(
      `You are a YouTube strategist for the Vidora AI studio. Generate clickable, original video ideas. Each idea is a JSON object: title (max 70 chars, curiosity-driven, no clickbait lies), hook (the first 3 seconds, verbatim opener), angle (2-3 sentences: the unique take), format (short|long — short = under 60s vertical, long = 8+ min horizontal), difficulty (easy|medium|hard to produce), safety_flag (safe|caution|risky — advertiser-friendliness for YouTube monetization; mark risky only when the idea touches sensitive topics). Return a JSON array.`,
      `${nicheCtx}\nLanguage: ${project.language}\nHow many ideas: ${data.count}\n\n${ownWinnersCtx}${outlierCtx}`,
    );
    const parsed = z.array(IdeaSchema).parse(ideas);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("video_ideas")
      .insert(
        parsed.map((idea) => ({
          user_id: userId,
          project_id: data.projectId,
          ...idea,
          status: "new",
        })),
      )
      .select("*");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const IdeaActionSchema = z.object({ id: z.string().uuid() });

async function ownIdea(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  userId: string,
  id: string,
) {
  const { data, error } = await supabase
    .from("video_ideas")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Idea not found");
  return data;
}

export const saveIdea = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => IdeaActionSchema.parse(i))
  .handler(async ({ data, context }) => {
    await ownIdea(context.supabase, context.userId, data.id);
    const { error } = await context.supabase
      .from("video_ideas")
      .update({ status: "saved" })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const dismissIdea = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => IdeaActionSchema.parse(i))
  .handler(async ({ data, context }) => {
    await ownIdea(context.supabase, context.userId, data.id);
    const { error } = await context.supabase
      .from("video_ideas")
      .update({ status: "dismissed" })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const UseIdeaSchema = z.object({
  id: z.string().uuid(),
  /** Which studio mode to hand off to. */
  mode: z.enum(["stock", "voiceover", "autoedit"]).default("stock"),
});

/**
 * Hand off an idea to the studio: creates a script project pre-filled with
 * the idea's title, hook, and angle, and marks the idea as used.
 */
export const useIdea = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => UseIdeaSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId, supabase } = context;
    const idea = await ownIdea(supabase, userId, data.id);

    const brief = [
      `VIDEO IDEA: ${idea.title}`,
      ``,
      `HOOK (first 3 seconds): ${idea.hook}`,
      ``,
      `ANGLE: ${idea.angle}`,
      ``,
      `FORMAT: ${idea.format === "short" ? "Vertical short (under 60 seconds)" : "Long-form (8+ minutes)"}`,
      `DIFFICULTY: ${idea.difficulty}`,
    ].join("\n");

    const { data: project, error } = await supabase
      .from("projects")
      .insert({
        user_id: userId,
        title: idea.title.slice(0, 120),
        topic: idea.title,
        script: brief,
        mode: data.mode,
        status: "draft",
        stage: "created",
        step: "Ready to generate",
        settings: {
          research_idea_id: idea.id,
          research_project_id: idea.project_id,
        },
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const { error: ideaError } = await supabase
      .from("video_ideas")
      .update({ status: "used", project_ref: project.id })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (ideaError) throw new Error(ideaError.message);

    return { projectId: project.id };
  });
