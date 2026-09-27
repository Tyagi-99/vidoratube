/**
 * Stream B — claims unit tests.
 * Pure linker + strict-gate logic: no Supabase, no network, no LLM.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateStrictGate,
  extractClaimCandidates,
  linkClaimsToSources,
  splitSentences,
  tokenize,
} from "./linker";
import { REVIEW_STATE_COPY, SaveClaimsSchema, SetReviewSchema, VERDICT_COPY } from "./types";

describe("splitSentences", () => {
  it("splits on sentence boundaries", () => {
    expect(splitSentences("Hello world. How are you? Fine!")).toEqual([
      "Hello world.",
      "How are you?",
      "Fine!",
    ]);
  });
  it("drops empty fragments", () => {
    expect(splitSentences("  ")).toEqual([]);
  });
});

describe("extractClaimCandidates", () => {
  it("flags sentences with numbers and research hints", () => {
    const out = extractClaimCandidates(
      "A 2021 study found that 40% of viewers skip intros. I think intros are boring.",
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toContain("40%");
    expect(out[0]!.reasons).toContain("contains a number");
    expect(out[0]!.reasons).toContain("cites research");
    expect(out[0]!.score).toBeGreaterThan(0);
    expect(out[0]!.score).toBeLessThanOrEqual(1);
  });
  it("flags superlative and causation claims", () => {
    const out = extractClaimCandidates("It was the largest launch because demand doubled.");
    expect(out).toHaveLength(1);
    expect(out[0]!.reasons).toContain("makes a superlative claim");
  });
  it("skips short fragments", () => {
    expect(extractClaimCandidates("Wow. Amazing!")).toEqual([]);
  });
  it("is deterministic", () => {
    const text = "Revenue grew 12% in 2024 after the rebrand.";
    expect(extractClaimCandidates(text)).toEqual(extractClaimCandidates(text));
  });
});

describe("tokenize", () => {
  it("lowercases and strips stopwords", () => {
    const toks = tokenize("The Quick, brown fox!");
    expect(toks).toContain("quick");
    expect(toks).toContain("brown");
    expect(toks).not.toContain("the");
  });
});

describe("linkClaimsToSources", () => {
  const sources = [
    {
      id: "11111111-1111-1111-1111-111111111111",
      title: "Airplane window hole study",
      url: "https://example.com/windows",
      excerpt: "Research on cabin pressure and the breather hole in airplane windows.",
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      title: "Best pasta recipes",
      url: null,
      excerpt: "Delicious carbonara and lasagna recipes for weeknights.",
    },
  ];
  it("links a claim to the source with shared vocabulary", () => {
    const linked = linkClaimsToSources(
      [{ text: "The tiny hole in airplane windows equalizes cabin pressure." }],
      sources,
    );
    expect(linked[0]!.matches.length).toBeGreaterThan(0);
    expect(linked[0]?.matches[0]?.sourceId).toBe(sources[0]?.id);
    expect(linked[0]?.matches[0]?.url).toBe("https://example.com/windows");
  });
  it("returns no matches for an unrelated claim", () => {
    const linked = linkClaimsToSources(
      [{ text: "Quantum tunneling enables stellar fusion." }],
      sources,
    );
    expect(linked[0]!.matches).toEqual([]);
  });
  it("caps matches at top-k sorted by score", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      id: `33333333-3333-3333-3333-33333333333${i}`,
      title: "airplane windows pressure cabin",
      url: null,
      excerpt: "airplane windows pressure cabin hole",
    }));
    const linked = linkClaimsToSources([{ text: "Airplane windows cabin pressure hole." }], many);
    expect(linked[0]!.matches.length).toBeLessThanOrEqual(3);
    const scores = linked[0]!.matches.map((m) => m.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });
});

describe("evaluateStrictGate", () => {
  const mk = (id: string, review_state: "unreviewed" | "confirmed" | "waived") => ({
    id,
    claim: `claim ${id}`,
    review_state,
  });
  it("is advisory when strict mode is off", () => {
    const g = evaluateStrictGate({ strictMode: false, claims: [mk("a", "unreviewed")] });
    expect(g.blocked).toBe(false);
    expect(g.message).toMatch(/advisory/);
  });
  it("fail-closes on any unreviewed claim when strict mode is on", () => {
    const g = evaluateStrictGate({
      strictMode: true,
      claims: [mk("a", "confirmed"), mk("b", "unreviewed")],
    });
    expect(g.blocked).toBe(true);
    expect(g.blocking.map((b) => b.id)).toEqual(["b"]);
    expect(g.message).toMatch(/BLOCKED/);
  });
  it("waived claims still block strict mode (D99: waived = unconfirmed)", () => {
    const g = evaluateStrictGate({
      strictMode: true,
      claims: [mk("a", "confirmed"), mk("b", "waived")],
    });
    expect(g.blocked).toBe(true);
    expect(g.blocking.map((b) => b.id)).toEqual(["b"]);
    expect(g.counts.waived).toBe(1);
    expect(g.message).toMatch(/waived counts as unconfirmed/);
  });
  it("passes when every claim is confirmed", () => {
    const g = evaluateStrictGate({
      strictMode: true,
      claims: [mk("a", "confirmed"), mk("b", "confirmed")],
    });
    expect(g.blocked).toBe(false);
    expect(g.message).toMatch(/all 2 claims confirmed/);
  });
  it("passes with zero claims (nothing to block)", () => {
    const g = evaluateStrictGate({ strictMode: true, claims: [] });
    expect(g.blocked).toBe(false);
  });
});

describe("claim schemas", () => {
  it("SaveClaimsSchema requires a source per claim (FK honesty)", () => {
    expect(() =>
      SaveClaimsSchema.parse({
        projectId: "123e4567-e89b-12d3-a456-426614174000",
        claims: [{ claim: "x", sourceId: "not-a-uuid" }],
      }),
    ).toThrow();
  });
  it("SetReviewSchema admits only explicit human decisions", () => {
    const ok = SetReviewSchema.parse({
      claimId: "123e4567-e89b-12d3-a456-426614174000",
      reviewState: "confirmed",
    });
    expect(ok.reviewState).toBe("confirmed");
    expect(() =>
      SetReviewSchema.parse({
        claimId: "123e4567-e89b-12d3-a456-426614174000",
        reviewState: "unreviewed",
      }),
    ).toThrow();
  });
  it("review-state and verdict copy covers every enum value", () => {
    for (const s of ["unreviewed", "confirmed", "waived"] as const) {
      expect(REVIEW_STATE_COPY[s].label.length).toBeGreaterThan(0);
    }
    for (const v of ["verified", "qualified", "unsupported", "disputed"] as const) {
      expect(VERDICT_COPY[v].label.length).toBeGreaterThan(0);
    }
  });
});
