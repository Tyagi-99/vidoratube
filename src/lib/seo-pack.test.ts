import { afterEach, describe, expect, it, vi } from "vitest";
import { generateSEOCopy } from "./seo.server";
import {
  buildDescription,
  formatSEOPack,
  rankTitles,
  scoreTitle,
  suggestTags,
} from "./seo";

/**
 * SEO pack generation from a fixture script (LLM call mocked).
 * The LLM proposes; deterministic seo.ts functions shape the final pack.
 */

const FIXTURE_SCRIPT_SUMMARY =
  "A 90-second explainer on how compound interest works: a saver puts $100 " +
  "a month into an index fund, the narrator walks through the 8% average " +
  "return math, and the payoff shows the balance crossing $150k after 25 years.";

const FIXTURE_LLM_RESPONSE = {
  titles: [
    "How $100 a Month Becomes $150,000 (Compound Interest)",
    "Compound Interest Explained: The $100/Month Millionaire Path",
    "Why Compound Interest Is the 8th Wonder of the World",
  ],
  hook: "What if $100 a month could quietly grow into six figures?",
  summary: FIXTURE_SCRIPT_SUMMARY,
  cta: "Subscribe for one money idea every week.",
  hashtags: ["personalfinance", "investing", "money"],
  outlierTerms: ["compound interest calculator", "how to start investing", "index fund returns"],
};

const FIXTURE_CHAPTERS = [
  { time: "0:00", label: "The $100/month habit" },
  { time: "0:24", label: "The 8% math, visualized" },
  { time: "1:02", label: "The $150k payoff" },
];

function mockSeoFetch() {
  vi.stubEnv("LOVABLE_API_KEY", "test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(FIXTURE_LLM_RESPONSE) } }],
      }),
    }),
  );
}

describe("generateSEOCopy (mocked LLM)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("builds an SEO pack from the fixture script", async () => {
    mockSeoFetch();
    const copy = await generateSEOCopy({
      videoTitle: "Compound Interest Explained",
      scriptSummary: FIXTURE_SCRIPT_SUMMARY,
      primaryKeyword: "compound interest",
      chapters: FIXTURE_CHAPTERS,
    });
    expect(copy.titles).toHaveLength(3);
    expect(copy.hook).toContain("$100 a month");
    expect(copy.hashtags).toContain("investing");
    expect(copy.outlierTerms.length).toBeGreaterThan(0);
  });

  it("throws a clear error when the gateway rejects", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );
    await expect(
      generateSEOCopy({
        videoTitle: "T",
        scriptSummary: FIXTURE_SCRIPT_SUMMARY,
        primaryKeyword: "money",
        chapters: [],
      }),
    ).rejects.toThrow(/SEO generation failed/);
  });
});

describe("SEO pack assembly (deterministic)", () => {
  it("ranks the LLM's title candidates with deterministic scoring", () => {
    const ranked = rankTitles(FIXTURE_LLM_RESPONSE.titles, "compound interest");
    expect(ranked).toHaveLength(3);
    // Sorted best-first.
    expect(ranked[0]!.score).toBeGreaterThanOrEqual(ranked[1]!.score);
    expect(ranked[1]!.score).toBeGreaterThanOrEqual(ranked[2]!.score);
    // Every title still scores against the primary keyword honestly.
    for (const r of ranked) {
      expect(scoreTitle(r.title, "compound interest").score).toBe(r.score);
    }
  });

  it("builds a description with YouTube chapter timestamps", () => {
    const description = buildDescription({
      hook: FIXTURE_LLM_RESPONSE.hook,
      summary: FIXTURE_LLM_RESPONSE.summary,
      chapters: FIXTURE_CHAPTERS,
      cta: FIXTURE_LLM_RESPONSE.cta,
      hashtags: FIXTURE_LLM_RESPONSE.hashtags,
    });
    expect(description).toContain("CHAPTERS:");
    expect(description).toContain("0:00 The $100/month habit");
    expect(description).toContain("1:02 The $150k payoff");
    expect(description).toContain("#investing");
    expect(description.length).toBeLessThanOrEqual(4900);
  });

  it("suggests tags within YouTube's 500-char limit", () => {
    const tags = suggestTags(["compound interest", "investing"], FIXTURE_LLM_RESPONSE.outlierTerms);
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.join(",").length).toBeLessThanOrEqual(500);
    expect(new Set(tags).size).toBe(tags.length); // deduped
  });

  it("formats the full pack as copy-pasteable text", () => {
    const ranked = rankTitles(FIXTURE_LLM_RESPONSE.titles, "compound interest");
    const description = buildDescription({
      hook: FIXTURE_LLM_RESPONSE.hook,
      summary: FIXTURE_LLM_RESPONSE.summary,
      chapters: FIXTURE_CHAPTERS,
      cta: FIXTURE_LLM_RESPONSE.cta,
      hashtags: FIXTURE_LLM_RESPONSE.hashtags,
    });
    const text = formatSEOPack({
      titles: ranked.map((r) => ({ title: r.title, score: r.score })),
      selectedTitle: ranked[0]!.title,
      description,
      tags: suggestTags(["compound interest"], FIXTURE_LLM_RESPONSE.outlierTerms),
      hashtags: FIXTURE_LLM_RESPONSE.hashtags.map((h) => `#${h}`),
      chapters: FIXTURE_CHAPTERS,
    });
    expect(text).toContain("TITLE");
    expect(text).toContain(ranked[0]!.title);
    expect(text).toContain("DESCRIPTION");
    expect(text).toContain("CHAPTERS");
    expect(text).toContain("0:24 The 8% math, visualized");
    expect(text).toContain("TAGS");
  });
});
