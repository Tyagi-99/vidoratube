import { describe, expect, it, vi } from "vitest";
import {
  AI_HERO_RUNTIME_CAP,
  HeroCapExceededError,
  applyHeroCap,
  buildSourceProvenanceRows,
  planSceneSources,
  recordSourceProvenance,
  resolveSceneSources,
  tierForScene,
} from "./source-select";
import { mockStock, MOCK_LICENSE } from "./mock";
import type { SourceSceneInput } from "./types";
import type { StockProvider } from "../providers/stock.server";

function scene(over: Partial<SourceSceneInput> = {}): SourceSceneInput {
  return { sceneId: "s1", durationSeconds: 10, ...over };
}

describe("source priority", () => {
  it("user-uploaded footage wins over stock and AI", () => {
    expect(
      tierForScene(
        scene({ userFootageUrl: "https://cdn/x.mp4", searchQueries: ["volcano"], stockEligible: true }),
      ),
    ).toBe("user_upload");
  });

  it("licensed stock is second when queries or eligibility exist", () => {
    expect(tierForScene(scene({ searchQueries: ["volcano"] }))).toBe("stock");
    expect(tierForScene(scene({ stockEligible: true }))).toBe("stock");
  });

  it("everything else is an AI hero candidate", () => {
    expect(tierForScene(scene())).toBe("ai_hero");
  });
});

describe("AI hero cap", () => {
  it("defaults to 10% of runtime", () => {
    expect(AI_HERO_RUNTIME_CAP).toBe(0.1);
  });

  it("9% hero runtime passes untouched", () => {
    // Realistic mix: one stock scene, 9s of hero on a 100s runtime.
    const mixed = [
      scene({ sceneId: "a", durationSeconds: 91, searchQueries: ["city"] }),
      scene({ sceneId: "b", durationSeconds: 9 }),
    ];
    const plan2 = planSceneSources(mixed);
    expect(plan2.heroTrimmed).toBe(false);
    expect(plan2.aiHeroSeconds).toBe(9);
    expect(plan2.heroCapSeconds).toBe(10);
  });

  it("11% hero runtime is trimmed to the 10% cap", () => {
    const scenes = [
      scene({ sceneId: "a", durationSeconds: 89, searchQueries: ["city"] }),
      scene({ sceneId: "b", durationSeconds: 11 }),
    ];
    const plan = planSceneSources(scenes);
    expect(plan.heroTrimmed).toBe(true);
    expect(plan.aiHeroSeconds).toBe(10); // floor(10% of 100s)
    expect(plan.decisions[1]!.heroTrimmed).toBe(true);
    expect(plan.decisions[1]!.aiHeroSeconds).toBe(10);
  });

  it("reject policy throws instead of trimming", () => {
    const scenes = [
      scene({ sceneId: "a", durationSeconds: 89, searchQueries: ["city"] }),
      scene({ sceneId: "b", durationSeconds: 11 }),
    ];
    expect(() => planSceneSources(scenes, { heroPolicy: "reject" })).toThrow(HeroCapExceededError);
  });

  it("applyHeroCap is the shared pure helper (quote UI and server agree)", () => {
    expect(applyHeroCap({ aiHeroSeconds: 9, totalSeconds: 100 })).toEqual({
      aiHeroSeconds: 9,
      capSeconds: 10,
      trimmed: false,
    });
    expect(applyHeroCap({ aiHeroSeconds: 11, totalSeconds: 100 })).toEqual({
      aiHeroSeconds: 10,
      capSeconds: 10,
      trimmed: true,
    });
  });
});

describe("stock resolution", () => {
  it("attaches mock assets and flags them when no keys are configured", async () => {
    const plan = await resolveSceneSources(
      [scene({ sceneId: "a", durationSeconds: 10, searchQueries: ["volcano"] })],
      { providers: [mockStock] },
    );
    const d = plan.decisions[0]!;
    expect(d.tier).toBe("stock");
    expect(d.stockAsset?.provider).toBe("mock");
    expect(d.stockAsset?.license).toBe(MOCK_LICENSE);
    expect(d.mockAsset).toBe(true);
    expect(plan.stockMock).toBe(true);
  });

  it("falls back to AI hero (re-capped) when no provider finds stock", async () => {
    // Selective provider: finds stock for "city" only — "nothing-matches" falls back.
    const cityAsset = (await mockStock.search("city", "video", 1))[0]!;
    const selective: StockProvider = {
      id: "pexels",
      configured: () => true,
      search: async (query) => (query === "city" ? [cityAsset] : []),
    };
    const plan = await resolveSceneSources(
      [
        scene({ sceneId: "a", durationSeconds: 90, searchQueries: ["city"] }),
        scene({ sceneId: "b", durationSeconds: 5, searchQueries: ["nothing-matches"] }),
        scene({ sceneId: "c", durationSeconds: 5 }),
      ],
      { providers: [selective] },
    );
    expect(plan.decisions[0]!.tier).toBe("stock");
    const b = plan.decisions[1]!;
    expect(b.tier).toBe("ai_hero");
    expect(b.stockFallback).toBe(true);
    // 5s (original hero) + 5s (fallback) = 10s of 100s — exactly at the cap.
    expect(plan.aiHeroSeconds).toBeLessThanOrEqual(10);
    expect(plan.heroTrimmed).toBe(false);
  });

  it("a failing provider never breaks the plan", async () => {
    const failing: StockProvider = {
      id: "pixabay",
      configured: () => true,
      search: async () => {
        throw new Error("network down");
      },
    };
    const plan = await resolveSceneSources(
      [scene({ sceneId: "a", durationSeconds: 10, searchQueries: ["volcano"] })],
      { providers: [failing, mockStock] },
    );
    expect(plan.decisions[0]!.tier).toBe("stock");
    expect(plan.decisions[0]!.stockAsset?.provider).toBe("mock");
  });
});

describe("provenance recording", () => {
  function fakeSupabase() {
    const inserts: { table: string; row: unknown }[] = [];
    const client = {
      from: (table: string) => ({
        insert: async (row: unknown) => {
          inserts.push({ table, row });
          return { error: null };
        },
      }),
    };
    return { client: client as never, inserts };
  }

  it("writes one asset_provenance row per chosen asset with license + scene link", async () => {
    const plan = await resolveSceneSources(
      [
        scene({ sceneId: "up", durationSeconds: 10, userFootageUrl: "https://cdn/me.mp4" }),
        scene({ sceneId: "st", durationSeconds: 10, searchQueries: ["volcano"] }),
        scene({ sceneId: "hero", durationSeconds: 5 }),
      ],
      { providers: [mockStock] },
    );
    const rows = buildSourceProvenanceRows(plan, {
      userId: "user-1",
      projectId: "proj-1",
      generatedHeroUrls: { hero: "https://cdn/hero.png" },
    });
    expect(rows).toHaveLength(3);

    const upload = rows.find((r) => r.sceneId === "up")!;
    expect(upload.provider).toBe("user_upload");
    expect(upload.license).toBe("User-owned footage");
    expect(upload.assetUrl).toBe("https://cdn/me.mp4");

    const stock = rows.find((r) => r.sceneId === "st")!;
    expect(stock.provider).toBe("mock");
    expect(stock.license).toBe(MOCK_LICENSE);
    expect(stock.licenseUrl).toBe("mock://stock");
    expect(stock.assetUrl).toMatch(/^mock:\/\//);

    const hero = rows.find((r) => r.sceneId === "hero")!;
    expect(hero.provider).toBe("ai");
    expect(hero.assetUrl).toBe("https://cdn/hero.png");

    for (const r of rows) {
      expect(r.userId).toBe("user-1");
      expect(r.projectId).toBe("proj-1");
      expect(r.sceneId).toBeTruthy();
    }
  });

  it("recordSourceProvenance inserts into asset_provenance and never throws", async () => {
    const { client, inserts } = fakeSupabase();
    const plan = await resolveSceneSources(
      [scene({ sceneId: "a", durationSeconds: 10, searchQueries: ["volcano"] })],
      { providers: [mockStock] },
    );
    await recordSourceProvenance(client, plan, { userId: "user-1", projectId: "proj-1" });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.table).toBe("asset_provenance");
    const row = inserts[0]!.row as Record<string, unknown>;
    expect(row["provider"]).toBe("mock");
    expect(row["scene_id"]).toBe("a");

    // A throwing client still resolves (recordProvenance logs only).
    const bad = { from: () => ({ insert: async () => { throw new Error("db down"); } }) } as never;
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(recordSourceProvenance(bad, plan, { userId: "u" })).resolves.toBeUndefined();
    err.mockRestore();
  });
});
