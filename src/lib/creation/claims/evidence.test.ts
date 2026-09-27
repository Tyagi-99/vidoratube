/**
 * Stream B — Evidence Desk business tests.
 * extractClaimsForScript / getEvidenceDeskState against an in-memory
 * ClaimsDataPort fake: no Supabase, no network, no LLM.
 *
 * Proves the read-only contract: extraction never saves or approves —
 * the reviewer explicitly adds claims, and D99 (waived = unconfirmed)
 * holds through the desk state.
 */
import { describe, expect, it } from "vitest";
import {
  extractClaimsForScript,
  getEvidenceDeskState,
  type ClaimsDataPort,
  type ClaimSourceLite,
} from "./evidence.functions";
import type { ClaimVerdict, ClaimWithSources, ResearchClaimRow } from "./types";

const UID = "123e4567-e89b-12d3-a456-426614174000";
const PID = "223e4567-e89b-12d3-a456-426614174000";
const SID = "323e4567-e89b-12d3-a456-426614174000";
const SRC = "423e4567-e89b-12d3-a456-426614174000";

const source: ClaimSourceLite = {
  id: SRC,
  title: "Airplane window breather-hole research",
  url: "https://example.com/windows",
  source_type: "article",
  published_at: "2024-01-01",
  excerpt: "Research on cabin pressure and the breather hole in airplane windows.",
};

function claimRow(review_state: ResearchClaimRow["review_state"]): ClaimWithSources {
  return {
    id: "523e4567-e89b-12d3-a456-426614174000",
    user_id: UID,
    source_id: SRC,
    claim: "The tiny hole in airplane windows equalizes cabin pressure.",
    verdict: "verified" as ClaimVerdict,
    evidence: {},
    review_state,
    reviewed_by: null,
    reviewed_at: null,
    review_note: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    sources: [
      {
        id: SRC,
        title: source.title,
        url: source.url,
        source_type: source.source_type,
        published_at: source.published_at,
      },
    ],
  };
}

function fakePort(
  opts: {
    scriptText?: string | null;
    sources?: ClaimSourceLite[];
    strictMode?: boolean;
    claims?: ClaimWithSources[];
  } = {},
): ClaimsDataPort & { inserted: number; reviews: { claimId: string; state: string }[] } {
  const claims = opts.claims ?? [];
  const port: ClaimsDataPort & { inserted: number; reviews: { claimId: string; state: string }[] } =
    {
      inserted: 0,
      reviews: [],
      getProjectStrictMode: async () => opts.strictMode ?? false,
      setProjectStrictMode: async () => {},
      listProjectSources: async () => opts.sources ?? [source],
      assertSourceInProject: async () => {},
      listProjectClaims: async () => claims,
      insertClaims: async (_u, rows) => {
        port.inserted += rows.length;
        return [];
      },
      setClaimReview: async (_u, claimId, reviewState, _note) => {
        port.reviews.push({ claimId, state: reviewState });
        const c = claims.find((x) => x.id === claimId);
        if (c) c.review_state = reviewState;
        return claims.find((x) => x.id === claimId)!;
      },
      getScriptText: async () =>
        opts.scriptText === null || opts.scriptText === undefined
          ? null
          : { projectId: PID, text: opts.scriptText },
    };
  return port;
}

describe("extractClaimsForScript", () => {
  it("reads the current script text and links candidates to canvas sources", async () => {
    const port = fakePort({
      scriptText:
        "Intro. The tiny hole in airplane windows equalizes cabin pressure because the panes flex at altitude.",
    });
    const out = await extractClaimsForScript(port, UID, SID);
    expect(out.sourceCount).toBe(1);
    expect(out.candidates.length).toBeGreaterThan(0);
    const target = out.candidates.find((c) => c.text.includes("equalizes cabin pressure"));
    expect(target).toBeDefined();
    expect(target!.matches.length).toBeGreaterThan(0);
    expect(target!.matches[0]!.sourceId).toBe(SRC);
  });

  it("saves nothing — extraction is read-only (reviewer adds explicitly)", async () => {
    const port = fakePort({ scriptText: "A 2021 study found that 40% of viewers skip intros." });
    await extractClaimsForScript(port, UID, SID);
    expect(port.inserted).toBe(0);
  });

  it("throws for a missing or unowned script (ownership fail-closed)", async () => {
    const port = fakePort({ scriptText: null });
    await expect(extractClaimsForScript(port, UID, SID)).rejects.toThrow(/Script not found/);
  });

  it("returns no candidates for a script with no factual sentences", async () => {
    const port = fakePort({ scriptText: "Wow. Amazing! So cool." });
    const out = await extractClaimsForScript(port, UID, SID);
    expect(out.candidates).toEqual([]);
    expect(port.inserted).toBe(0);
  });
});

describe("getEvidenceDeskState + D99 review decisions", () => {
  it("waived claims still block strict mode through the desk state", async () => {
    const port = fakePort({ strictMode: true, claims: [claimRow("waived")] });
    const state = await getEvidenceDeskState(port, UID, PID);
    expect(state.strictMode).toBe(true);
    expect(state.gate.blocked).toBe(true);
  });

  it("an explicit human confirm unblocks a waived claim", async () => {
    const existing = claimRow("waived");
    const port = fakePort({ strictMode: true, claims: [existing] });
    await port.setClaimReview(UID, existing.id, "confirmed", "checked against source");
    const state = await getEvidenceDeskState(port, UID, PID);
    expect(port.reviews).toHaveLength(1);
    expect(port.reviews[0]!.state).toBe("confirmed");
    expect(state.gate.blocked).toBe(false);
  });

  it("desk state is advisory (not blocked) when strict mode is off", async () => {
    const port = fakePort({ strictMode: false, claims: [claimRow("unreviewed")] });
    const state = await getEvidenceDeskState(port, UID, PID);
    expect(state.gate.blocked).toBe(false);
  });
});
