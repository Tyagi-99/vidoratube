/**
 * Stream B — research-canvas unit tests.
 * Pure helpers + business logic against an in-memory fake port: no Supabase,
 * no network. Server-fn wrappers are thin.
 */
import { describe, expect, it } from "vitest";
import { formatFreshness, formatSourceDate, isSourceStale } from "./format";
import {
  CreateSourceSchema,
  SOURCE_TYPE_BADGES,
  type CanvasSource,
  type ResearchSourceRow,
} from "./types";
import {
  listCanvas,
  validateReorder,
  type ResearchCanvasDataPort,
} from "./research-canvas.functions";

const NOW = new Date("2026-09-28T00:00:00.000Z").getTime();
const minAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const hourAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const dayAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

function source(over: Partial<ResearchSourceRow> = {}): ResearchSourceRow {
  return {
    id: "src-1",
    user_id: "user-1",
    project_id: "proj-1",
    research_project_id: null,
    source_type: "web",
    url: "https://example.com/a",
    title: "Example article",
    excerpt: "An excerpt.",
    content: null,
    published_at: null,
    credibility: {},
    metadata: {},
    position: 0,
    created_at: dayAgo(1),
    updated_at: dayAgo(1),
    ...over,
  };
}

function fakePort(
  sources: ResearchSourceRow[],
  claims: Record<string, number> = {},
): ResearchCanvasDataPort {
  return {
    listSources: async () => [...sources].sort((a, b) => a.position - b.position),
    countClaims: async (_u, ids) => Object.fromEntries(ids.map((id) => [id, claims[id] ?? 0])),
    insertSource: async () => {
      throw new Error("not needed");
    },
    updateSource: async () => {
      throw new Error("not needed");
    },
    deleteSource: async () => {},
    setPositions: async () => {},
    assertProjectOwned: async () => {},
  };
}

describe("formatFreshness", () => {
  it("labels sub-minute timestamps as just now", () => {
    expect(formatFreshness(new Date(NOW - 30_000).toISOString(), NOW)).toBe("just now");
  });
  it("labels minutes", () => {
    expect(formatFreshness(minAgo(5), NOW)).toBe("5 min ago");
  });
  it("labels hours with pluralization", () => {
    expect(formatFreshness(hourAgo(1), NOW)).toBe("1 hour ago");
    expect(formatFreshness(hourAgo(3), NOW)).toBe("3 hours ago");
  });
  it("labels days", () => {
    expect(formatFreshness(dayAgo(2), NOW)).toBe("2 days ago");
  });
  it("falls back to an absolute date past 30 days", () => {
    const label = formatFreshness(dayAgo(60), NOW);
    expect(label).toMatch(/2026/);
  });
  it("is honest about missing/invalid dates", () => {
    expect(formatFreshness(null, NOW)).toBe("date unknown");
    expect(formatFreshness(undefined, NOW)).toBe("date unknown");
    expect(formatFreshness("not-a-date", NOW)).toBe("date unknown");
  });
  it("clamps future timestamps to just now (clock skew)", () => {
    expect(formatFreshness(new Date(NOW + 3_600_000).toISOString(), NOW)).toBe("just now");
  });
});

describe("formatSourceDate / isSourceStale", () => {
  it("formats a published date", () => {
    expect(formatSourceDate("2026-01-15T00:00:00Z")).toMatch(/Jan/);
    expect(formatSourceDate(null)).toBe("date unknown");
  });
  it("flags sources older than 180 days as stale", () => {
    expect(isSourceStale(dayAgo(200), NOW)).toBe(true);
    expect(isSourceStale(dayAgo(30), NOW)).toBe(false);
  });
  it("never labels an unknown date as stale", () => {
    expect(isSourceStale(null, NOW)).toBe(false);
    expect(isSourceStale("garbage", NOW)).toBe(false);
  });
});

describe("SOURCE_TYPE_BADGES", () => {
  it("covers every source type the table allows", () => {
    for (const t of ["web", "video", "paper", "transcript", "upload", "other"] as const) {
      expect(SOURCE_TYPE_BADGES[t].label.length).toBeGreaterThan(0);
    }
  });
});

describe("CreateSourceSchema", () => {
  const base = {
    projectId: "123e4567-e89b-12d3-a456-426614174000",
    sourceType: "web" as const,
    title: "A title",
  };
  it("accepts a minimal valid source", () => {
    expect(CreateSourceSchema.parse(base).title).toBe("A title");
  });
  it("rejects empty titles and bad urls", () => {
    expect(() => CreateSourceSchema.parse({ ...base, title: "  " })).toThrow();
    expect(() => CreateSourceSchema.parse({ ...base, url: "not a url" })).toThrow();
  });
  it("accepts an empty-string url (optional source link)", () => {
    expect(CreateSourceSchema.parse({ ...base, url: "" }).url).toBe("");
  });
  it("rejects unknown source types", () => {
    expect(() => CreateSourceSchema.parse({ ...base, sourceType: "tweet" })).toThrow();
  });
});

describe("validateReorder", () => {
  const rows = [
    source({ id: "a", position: 0 }),
    source({ id: "b", position: 1 }),
    source({ id: "c", position: 2 }),
  ];
  it("accepts a complete permutation", () => {
    expect(() => validateReorder(rows, ["c", "a", "b"])).not.toThrow();
  });
  it("rejects duplicates", () => {
    expect(() => validateReorder(rows, ["a", "a", "b"])).toThrow(/duplicate/);
  });
  it("rejects unknown ids", () => {
    expect(() => validateReorder(rows, ["a", "b", "zzz"])).toThrow(/unknown/);
  });
  it("rejects a partial order (would silently drop a source)", () => {
    expect(() => validateReorder(rows, ["a", "b"])).toThrow(/every source/);
  });
});

describe("listCanvas", () => {
  it("merges claim counts and keeps position order", async () => {
    const rows = [source({ id: "b", position: 1 }), source({ id: "a", position: 0 })];
    const port = fakePort(rows, { a: 3 });
    const out: CanvasSource[] = await listCanvas(port, "user-1", "proj-1");
    expect(out.map((s) => s.id)).toEqual(["a", "b"]);
    expect(out[0]!.claimCount).toBe(3);
    expect(out[1]!.claimCount).toBe(0);
  });
});
