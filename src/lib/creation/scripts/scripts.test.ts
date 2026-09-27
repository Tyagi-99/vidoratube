/**
 * Stream B — scripts unit tests.
 * Pure helpers + business logic against an in-memory fake ScriptDataPort:
 * no Supabase, no network, no LLM. Server-fn wrappers are thin.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { countWords, estimateScriptTiming, estimateSectionSeconds, formatClock } from "./timing";
import { diffScriptVersions } from "./diff";
import { BrandVoiceContextSchema, validateStatusTransition } from "./types";
import {
  ScriptLockedError,
  buildFullText,
  buildScriptPrompt,
  generateScriptDraft,
  restoreScriptVersion,
  saveScriptVersion,
  setScriptStatus,
  type ScriptDataPort,
} from "./scripts.functions";
import type { PreflightResult } from "@/lib/credits/preflight.server";
import type { BrandVoiceContext, ScriptRow, ScriptSection, ScriptVersionRow } from "./types";

vi.mock("@/lib/credits/preflight.server", () => ({
  preflightCreditsCheck: vi.fn(),
}));

vi.mock("@/lib/credits", () => ({
  debitOneCreditForProject: vi.fn(),
  OUT_OF_CREDITS_MESSAGE: "OUT_OF_CREDITS",
}));

vi.mock("@/lib/api-cost", () => ({
  recordApiCost: vi.fn(),
  gatewayChatUnitCostUsd: vi.fn(() => 0.001),
}));

async function mockPreflight(result: PreflightResult) {
  const mod = await import("@/lib/credits/preflight.server");
  vi.mocked(mod.preflightCreditsCheck).mockResolvedValue(result);
}

const deniedPreflight = (): PreflightResult => ({
  ok: false,
  code: "INSUFFICIENT_CREDITS",
  message: "Not enough credits",
  estimate: { isEstimate: true, type: "estimate", credits: 2, breakdown: { lines: [] } },
});

const okPreflight = (): PreflightResult => ({
  ok: true,
  estimate: { isEstimate: true, type: "estimate", credits: 1, breakdown: { lines: [] } },
  balance: 10,
  warnings: [],
});

const UID = "123e4567-e89b-12d3-a456-426614174000";
const sid = (n: number) => `123e4567-e89b-12d3-a456-4266141740${String(n).padStart(2, "0")}`;

function section(id: string, heading: string, body: string): ScriptSection {
  return { id, heading, body };
}

/** In-memory ScriptDataPort fake. */
function fakePort(
  opts: {
    status?: ScriptRow["status"];
    strictMode?: boolean;
    claims?: { id: string; claim: string; review_state: "unreviewed" | "confirmed" | "waived" }[];
  } = {},
): ScriptDataPort & { createdScripts: number; versions: ScriptVersionRow[] } {
  const scripts = new Map<string, ScriptRow>();
  const versions: ScriptVersionRow[] = [];
  const script: ScriptRow = {
    id: sid(1),
    user_id: UID,
    project_id: sid(9),
    title: "Test script",
    status: opts.status ?? "draft",
    current_version_id: null,
    word_count: 0,
    brand_profile_id: null,
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  scripts.set(script.id, script);
  let createdScripts = 0;

  const port: ScriptDataPort & { createdScripts: number; versions: ScriptVersionRow[] } = {
    createdScripts: 0,
    versions,
    getProject: async () => ({
      id: script.project_id,
      research_strict_mode: opts.strictMode ?? false,
    }),
    listScripts: async () => [...scripts.values()],
    createScript: async (_u, _p, title) => {
      createdScripts++;
      port.createdScripts = createdScripts;
      const s: ScriptRow = {
        ...script,
        id: sid(50 + createdScripts),
        title,
        status: "draft",
        current_version_id: null,
        word_count: 0,
      };
      scripts.set(s.id, s);
      return s;
    },
    getScript: async (_u, id) => scripts.get(id) ?? null,
    getCurrentVersion: async (_u, id) => {
      const s = scripts.get(id);
      return versions.find((v) => v.id === s?.current_version_id) ?? null;
    },
    getMaxVersionNumber: async (id) =>
      versions.filter((v) => v.script_id === id).reduce((m, v) => Math.max(m, v.version_number), 0),
    insertVersion: async (input) => {
      const v: ScriptVersionRow = {
        id: sid(70 + versions.length),
        script_id: input.scriptId,
        version_number: input.versionNumber,
        sections: input.sections,
        full_text: input.fullText,
        word_count: input.wordCount,
        timing: input.timing,
        created_by: input.createdBy,
        change_note: input.changeNote,
        created_at: new Date().toISOString(),
      };
      versions.push(v);
      return v;
    },
    setCurrentVersion: async (id, versionId, wordCount) => {
      const s = scripts.get(id);
      if (s) {
        s.current_version_id = versionId;
        s.word_count = wordCount;
      }
    },
    listVersions: async (_u, id) => {
      if (!scripts.get(id)) throw new Error("Script not found");
      return versions
        .filter((v) => v.script_id === id)
        .sort((a, b) => b.version_number - a.version_number);
    },
    getVersion: async (_u, versionId) => {
      const v = versions.find((x) => x.id === versionId);
      return v ? { ...v, script_id: v.script_id } : null;
    },
    setStatus: async (_u, id, status) => {
      const s = scripts.get(id);
      if (!s) throw new Error("Script not found");
      s.status = status;
      return s;
    },
    bindBrandProfile: async (_u, id, bp) => {
      const s = scripts.get(id)!;
      s.brand_profile_id = bp;
      return s;
    },
    listBrandProfiles: async () => [{ id: sid(2), name: "Voice" }],
    getBrandProfile: async () => null,
    listClaimReviewStates: async () => opts.claims ?? [],
  };
  return port;
}

const brand: BrandVoiceContext = BrandVoiceContextSchema.parse({
  id: sid(2),
  name: "Test voice",
  tone: "playful but precise",
  vocabulary: { level: "simple" },
  persona: "a curious friend",
  do_list: ["use short sentences"],
  dont_list: ["never use jargon"],
  sample_text: "Hey, look at this!",
});

describe("timing estimator", () => {
  it("estimates 150 words at 150wpm as 60s", () => {
    expect(estimateSectionSeconds(Array(150).fill("word").join(" "))).toBe(60);
  });
  it("returns 0 for empty bodies (no fake minimum)", () => {
    expect(estimateSectionSeconds("")).toBe(0);
    expect(estimateSectionSeconds("   ")).toBe(0);
  });
  it("rejects non-positive wpm", () => {
    expect(() => estimateSectionSeconds("hello world test case", 0)).toThrow(/wpm/);
  });
  it("sums section ESTIMATES into a script total", () => {
    const est = estimateScriptTiming([
      section(sid(1), "A", Array(150).fill("word").join(" ")),
      section(sid(2), "B", Array(75).fill("word").join(" ")),
    ]);
    expect(est.totalSeconds).toBe(90);
    expect(est.totalWords).toBe(225);
    expect(est.wpm).toBe(150);
  });
  it("formatClock renders m:ss", () => {
    expect(formatClock(90)).toBe("1:30");
    expect(formatClock(5)).toBe("0:05");
  });
  it("countWords counts whitespace-separated tokens", () => {
    expect(countWords("  hello   world ")).toBe(2);
  });
});

describe("diffScriptVersions", () => {
  const a = section(sid(1), "Intro", "hello");
  const b = section(sid(2), "Body", "world");
  it("reports no diffs for identical lists", () => {
    expect(diffScriptVersions([a, b], [a, b])).toEqual([]);
  });
  it("detects added / removed / modified / moved", () => {
    const added = section(sid(3), "Outro", "bye");
    const modified = { ...b, body: "world!" };
    const diffs = diffScriptVersions([a, b], [modified, a, added]);
    const byType = Object.fromEntries(diffs.map((d) => [d.sectionId, d.type]));
    expect(byType[sid(3)]).toBe("added");
    expect(byType[sid(2)]).toBe("modified");
    expect(byType[sid(1)]).toBe("moved");
    expect(diffs.find((d) => d.type === "modified")!.before!.body).toBe("world");
    expect(diffs.find((d) => d.type === "modified")!.after!.body).toBe("world!");
  });
  it("detects removals", () => {
    const diffs = diffScriptVersions([a, b], [a]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.type).toBe("removed");
    expect(diffs[0]!.after).toBeNull();
  });
});

describe("validateStatusTransition", () => {
  it("allows draft → in_review → approved → locked", () => {
    expect(() => validateStatusTransition("draft", "in_review")).not.toThrow();
    expect(() => validateStatusTransition("in_review", "approved")).not.toThrow();
    expect(() => validateStatusTransition("approved", "locked")).not.toThrow();
  });
  it("rejects skipping review", () => {
    expect(() => validateStatusTransition("draft", "approved")).toThrow(/Cannot move/);
    expect(() => validateStatusTransition("draft", "locked")).toThrow();
  });
  it("locked can only be unlocked to in_review", () => {
    expect(() => validateStatusTransition("locked", "in_review")).not.toThrow();
    expect(() => validateStatusTransition("locked", "draft")).toThrow();
    expect(() => validateStatusTransition("locked", "approved")).toThrow();
  });
  it("allows a no-op transition", () => {
    expect(() => validateStatusTransition("draft", "draft")).not.toThrow();
  });
});

describe("buildScriptPrompt", () => {
  it("carries the brand voice into the prompt", () => {
    const { system } = buildScriptPrompt("black holes", 5, brand);
    expect(system).toContain("playful but precise");
    expect(system).toContain("a curious friend");
    expect(system).toContain("use short sentences");
    expect(system).toContain("never use jargon");
    expect(system).toContain("Hey, look at this!");
  });
  it("works without a brand profile", () => {
    const { system, user } = buildScriptPrompt("black holes", 3, null);
    expect(system).not.toContain("BRAND VOICE");
    expect(user).toContain("3-section");
  });
  it("carries the brand vocabulary into the prompt (deterministic JSON)", () => {
    const withVocab: BrandVoiceContext = BrandVoiceContextSchema.parse({
      ...brand,
      vocabulary: { avoid: "utilize", preferred: "use", level: "simple" },
    });
    const { system } = buildScriptPrompt("black holes", 5, withVocab);
    expect(system).toContain("Vocabulary:");
    expect(system).toContain('"avoid":"utilize"');
    expect(system).toContain('"preferred":"use"');
    // Sorted keys: avoid < level < preferred
    const line = system.split("\n").find((l) => l.startsWith("Vocabulary:"));
    expect(line!.indexOf('"avoid"')).toBeLessThan(line!.indexOf('"level"'));
    expect(line!.indexOf('"level"')).toBeLessThan(line!.indexOf('"preferred"'));
  });
  it("omits the vocabulary line when vocabulary is empty", () => {
    const noVocab: BrandVoiceContext = BrandVoiceContextSchema.parse({ ...brand, vocabulary: {} });
    const { system } = buildScriptPrompt("black holes", 5, noVocab);
    expect(system).not.toContain("Vocabulary:");
  });
});

describe("buildFullText", () => {
  it("joins headings and bodies", () => {
    expect(buildFullText([section(sid(1), "Intro", "hello")])).toBe("Intro\nhello");
  });
});

describe("saveScriptVersion", () => {
  it("writes a new version row per save (append-only)", async () => {
    const port = fakePort();
    const s = [section(sid(1), "Intro", Array(150).fill("word").join(" "))];
    const r1 = await saveScriptVersion(port, UID, sid(1), s, "first");
    const r2 = await saveScriptVersion(
      port,
      UID,
      sid(1),
      [...s, section(sid(2), "More", "text")],
      "second",
    );
    expect(r1.version.version_number).toBe(1);
    expect(r2.version.version_number).toBe(2);
    expect(port.versions).toHaveLength(2);
    expect(r2.version.word_count).toBe(151);
    expect(r2.version.timing.totalSeconds).toBeGreaterThan(0);
    expect(r2.version.timing.wpm).toBe(150);
  });
  it("refuses to write to a locked script (server-enforced)", async () => {
    const port = fakePort({ status: "locked" });
    await expect(
      saveScriptVersion(port, UID, sid(1), [section(sid(1), "Intro", "x")], null),
    ).rejects.toBeInstanceOf(ScriptLockedError);
    expect(port.versions).toHaveLength(0);
  });
  it("throws for a missing script", async () => {
    const port = fakePort();
    await expect(
      saveScriptVersion(port, UID, sid(99), [section(sid(1), "Intro", "x")], null),
    ).rejects.toThrow(/not found/);
  });
});

describe("restoreScriptVersion", () => {
  it("creates a new version copying the old one (history intact)", async () => {
    const port = fakePort();
    await saveScriptVersion(port, UID, sid(1), [section(sid(1), "Intro", "v1 text")], "v1");
    const v1id = port.versions[0]!.id;
    await saveScriptVersion(port, UID, sid(1), [section(sid(1), "Intro", "v2 text")], "v2");
    const { version } = await restoreScriptVersion(port, UID, v1id);
    expect(version.version_number).toBe(3);
    expect(version.sections[0]!.body).toBe("v1 text");
    expect(version.change_note).toBe("Restored from v1");
    expect(port.versions).toHaveLength(3);
  });
  it("refuses restore into a locked script", async () => {
    const port = fakePort({ status: "locked" });
    await expect(restoreScriptVersion(port, UID, sid(70))).rejects.toThrow();
  });
});

describe("setScriptStatus", () => {
  it("blocks approval under strict mode with unreviewed claims (fail-closed)", async () => {
    const port = fakePort({
      status: "in_review",
      strictMode: true,
      claims: [{ id: sid(3), claim: "c", review_state: "unreviewed" }],
    });
    await expect(setScriptStatus(port, UID, sid(1), "approved")).rejects.toThrow(
      /Strict mode is on/,
    );
  });
  it("approves when strict mode is on and all claims are reviewed", async () => {
    const port = fakePort({
      status: "in_review",
      strictMode: true,
      claims: [{ id: sid(3), claim: "c", review_state: "confirmed" }],
    });
    const { script } = await setScriptStatus(port, UID, sid(1), "approved");
    expect(script.status).toBe("approved");
  });
  it("approves freely when strict mode is off", async () => {
    const port = fakePort({ status: "in_review" });
    const { script } = await setScriptStatus(port, UID, sid(1), "approved");
    expect(script.status).toBe("approved");
  });
  it("rejects illegal transitions before any gate check", async () => {
    const port = fakePort({ status: "draft" });
    await expect(setScriptStatus(port, UID, sid(1), "locked")).rejects.toThrow(/Cannot move/);
  });
});

describe("generateScriptDraft", () => {
  beforeEach(() => {
    vi.stubEnv("LOVABLE_API_KEY", "");
    vi.unstubAllGlobals();
  });

  it("returns a denied envelope without touching providers or the DB", async () => {
    await mockPreflight(deniedPreflight());
    const port = fakePort();
    const out = await generateScriptDraft(port, {} as never, UID, {
      projectId: sid(9),
      topic: "black holes",
      sectionCount: 3,
    });
    expect(out.ok).toBe(false);
    expect(out.status).toBe("error");
    expect(out.error!.code).toBe("INSUFFICIENT_CREDITS");
    expect(out.output).toBeNull();
    expect(port.versions).toHaveLength(0);
  });

  it("returns an honest unconfigured envelope when no AI key is set", async () => {
    await mockPreflight(okPreflight());
    const port = fakePort();
    const out = await generateScriptDraft(port, {} as never, UID, {
      projectId: sid(9),
      topic: "black holes",
      sectionCount: 3,
    });
    expect(out.ok).toBe(false);
    expect(out.status).toBe("unconfigured");
    expect(out.error!.message).toMatch(/LOVABLE_API_KEY/);
    expect(port.versions).toHaveLength(0);
  });
});

describe("generateScriptDraft billing", () => {
  const aiSections = [
    { heading: "Intro", body: "Hello world" },
    { heading: "Body", body: "More words here" },
  ];
  const mockAiOk = () =>
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ sections: aiSections }) } }],
        }),
      }),
    );

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.stubEnv("LOVABLE_API_KEY", "test-key");
    await mockPreflight(okPreflight());
  });

  it("debits before persisting, reports actualCost 1, and saves the draft", async () => {
    mockAiOk();
    const credits = await import("@/lib/credits");
    const order: string[] = [];
    vi.mocked(credits.debitOneCreditForProject).mockImplementation(async () => {
      order.push("debit");
    });
    const port = fakePort();
    const origInsert = port.insertVersion.bind(port);
    port.insertVersion = async (input) => {
      order.push("persist");
      return origInsert(input);
    };
    const out = await generateScriptDraft(port, {} as never, UID, {
      projectId: sid(9),
      topic: "black holes",
      sectionCount: 2,
    });
    expect(out.ok).toBe(true);
    expect(out.status).toBe("ok");
    expect(out.actualCost).toBe(1);
    expect(out.output!.scriptId).toBe(sid(1));
    expect(port.versions).toHaveLength(1);
    expect(order).toEqual(["debit", "persist"]);
  });

  it("a failed debit returns an INSUFFICIENT_CREDITS envelope and saves nothing", async () => {
    mockAiOk();
    const credits = await import("@/lib/credits");
    vi.mocked(credits.debitOneCreditForProject).mockRejectedValue(
      new Error(credits.OUT_OF_CREDITS_MESSAGE),
    );
    const port = fakePort();
    const out = await generateScriptDraft(port, {} as never, UID, {
      projectId: sid(9),
      topic: "black holes",
      sectionCount: 2,
    });
    expect(out.ok).toBe(false);
    expect(out.error!.code).toBe("INSUFFICIENT_CREDITS");
    expect(out.output).toBeNull();
    expect(port.versions).toHaveLength(0);
  });

  it("a generic debit failure never throws — it returns a DEBIT_FAILED envelope", async () => {
    mockAiOk();
    const credits = await import("@/lib/credits");
    vi.mocked(credits.debitOneCreditForProject).mockRejectedValue(new Error("db exploded"));
    const port = fakePort();
    const out = await generateScriptDraft(port, {} as never, UID, {
      projectId: sid(9),
      topic: "black holes",
      sectionCount: 2,
    });
    expect(out.ok).toBe(false);
    expect(out.error!.code).toBe("DEBIT_FAILED");
    expect(port.versions).toHaveLength(0);
  });

  it("does not debit when the AI response is unparseable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "not json at all" } }] }),
      }),
    );
    const credits = await import("@/lib/credits");
    const debit = vi.mocked(credits.debitOneCreditForProject).mockResolvedValue(undefined);
    const port = fakePort();
    const out = await generateScriptDraft(port, {} as never, UID, {
      projectId: sid(9),
      topic: "black holes",
      sectionCount: 2,
    });
    expect(out.ok).toBe(false);
    expect(out.error!.code).toBe("bad_response");
    expect(debit).not.toHaveBeenCalled();
    expect(port.versions).toHaveLength(0);
  });
});
