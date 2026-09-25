/**
 * P5: server-side SEO copy generation via the Lovable AI gateway.
 * The LLM proposes; deterministic scoring in seo.ts ranks.
 */

function apiKey(): string {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI is not configured on this project.");
  return key;
}

export interface SEOCopyInput {
  videoTitle: string;
  scriptSummary: string;
  primaryKeyword: string;
  chapters: { time: string; label: string }[];
}

export interface SEOCopy {
  titles: string[];
  hook: string;
  summary: string;
  cta: string;
  hashtags: string[];
  outlierTerms: string[];
}

export async function generateSEOCopy(
  input: SEOCopyInput,
  /** Cost ctx: when provided, the SEO LLM call's measured cost is recorded. */
  cost?: {
    admin: import("@supabase/supabase-js").SupabaseClient<import("@/integrations/supabase/types").Database>;
    userId: string;
    projectId?: string | null | undefined;
  },
): Promise<SEOCopy> {
  const system =
    "You are a YouTube SEO specialist. Respond with JSON only: " +
    '{"titles": ["...", "...", "..."], "hook": "...", "summary": "...", "cta": "...", "hashtags": ["..."], "outlierTerms": ["..."]}. ' +
    "Titles: 3 distinct options, 40-60 chars, no clickbait lies. " +
    "Hook: one compelling opening line for the description. " +
    "Summary: 2-3 sentences. CTA: subscribe call-to-action. " +
    "Hashtags: 3-5 without #. outlierTerms: 5-8 search terms viewers use.";
  const user =
    `Video title: ${input.videoTitle}\nPrimary keyword: ${input.primaryKeyword}\n` +
    `Script summary: ${input.scriptSummary}\n` +
    (input.chapters.length > 0
      ? `Chapters: ${input.chapters.map((c) => `${c.time} ${c.label}`).join(", ")}\n`
      : "");

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`SEO generation failed (${res.status})`);
  const payload = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  if (cost) {
    const {
      extractUsage,
      estimateTokens,
      gatewayChatUnitCostUsd,
      recordApiCost,
    } = await import("./api-cost");
    const usage = extractUsage(payload);
    const inputTokens = usage?.inputTokens ?? estimateTokens(system + user);
    const outputTokens = usage?.outputTokens ?? 0;
    await recordApiCost(cost.admin, {
      userId: cost.userId,
      projectId: cost.projectId,
      provider: "lovable-ai",
      operation: "seo_copy",
      units: inputTokens + outputTokens,
      unitCostUsd: gatewayChatUnitCostUsd(inputTokens, outputTokens),
      meta: {
        model: "google/gemini-2.5-flash",
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        usage_reported: usage !== null,
        cost_basis: "gateway-passthrough-estimate",
      },
    });
  }
  const raw = payload.choices?.[0]?.message?.content ?? "{}";
  let parsed: Partial<SEOCopy>;
  try {
    parsed = JSON.parse(raw) as Partial<SEOCopy>;
  } catch {
    throw new Error("SEO generation returned invalid JSON.");
  }
  return {
    titles: Array.isArray(parsed.titles) ? parsed.titles.slice(0, 3).map(String) : [input.videoTitle],
    hook: String(parsed.hook ?? ""),
    summary: String(parsed.summary ?? input.scriptSummary.slice(0, 300)),
    cta: String(parsed.cta ?? ""),
    hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.map(String).slice(0, 5) : [],
    outlierTerms: Array.isArray(parsed.outlierTerms) ? parsed.outlierTerms.map(String).slice(0, 8) : [],
  };
}
