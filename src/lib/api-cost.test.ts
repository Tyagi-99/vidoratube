import { describe, expect, it, vi } from "vitest";
import {
  ELEVENLABS_TTS_USD_PER_CHAR,
  estimateTokens,
  extractUsage,
  gatewayChatUnitCostUsd,
  recordApiCost,
} from "./api-cost";

function mockAdmin() {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const admin = {
    from: vi.fn().mockReturnValue({ insert }),
  };
  return { admin: admin as never, insert };
}

describe("recordApiCost", () => {
  it("writes provider, operation, units and units*unitCostUsd to api_usage", async () => {
    const { admin, insert } = mockAdmin();
    await recordApiCost(admin, {
      userId: "user-1",
      projectId: "proj-1",
      provider: "elevenlabs",
      operation: "tts",
      units: 2000,
      unitCostUsd: ELEVENLABS_TTS_USD_PER_CHAR,
      meta: { model: "eleven_flash_v2_5" },
    });
    expect(insert).toHaveBeenCalledOnce();
    const row = insert.mock.calls[0]![0] as Record<string, unknown>;
    expect(row["user_id"]).toBe("user-1");
    expect(row["project_id"]).toBe("proj-1");
    expect(row["provider"]).toBe("elevenlabs");
    expect(row["operation"]).toBe("tts");
    expect(row["units"]).toBe(2000);
    // 2000 chars * $0.05/1000 = $0.10
    expect(row["estimated_cost"]).toBeCloseTo(0.1, 10);
    expect(row["meta"]).toEqual({ model: "eleven_flash_v2_5" });
  });

  it("defaults project_id to null and meta to {}", async () => {
    const { admin, insert } = mockAdmin();
    await recordApiCost(admin, {
      userId: "user-1",
      provider: "shotstack",
      operation: "render_submit",
      units: 2,
      unitCostUsd: 0.25,
    });
    const row = insert.mock.calls[0]![0] as Record<string, unknown>;
    expect(row["project_id"]).toBeNull();
    expect(row["meta"]).toEqual({});
    expect(row["estimated_cost"]).toBeCloseTo(0.5, 10);
  });

  it("never throws when the insert fails", async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: "boom" } });
    const admin = { from: vi.fn().mockReturnValue({ insert }) } as never;
    await expect(
      recordApiCost(admin, {
        userId: "u",
        provider: "x",
        operation: "y",
        units: 1,
        unitCostUsd: 1,
      }),
    ).resolves.toBeUndefined();
  });

  it("never throws when the client throws", async () => {
    const admin = {
      from: vi.fn().mockImplementation(() => {
        throw new Error("network down");
      }),
    } as never;
    await expect(
      recordApiCost(admin, {
        userId: "u",
        provider: "x",
        operation: "y",
        units: 1,
        unitCostUsd: 1,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("extractUsage", () => {
  it("pulls OpenAI-compatible token counts from a gateway payload", () => {
    expect(
      extractUsage({ usage: { prompt_tokens: 1200, completion_tokens: 800, total_tokens: 2000 } }),
    ).toEqual({ inputTokens: 1200, outputTokens: 800, totalTokens: 2000 });
  });

  it("derives total from the parts when total_tokens is missing", () => {
    expect(extractUsage({ usage: { prompt_tokens: 100, completion_tokens: 50 } })).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    });
  });

  it("returns null when there is no usage block", () => {
    expect(extractUsage({ choices: [] })).toBeNull();
    expect(extractUsage(null)).toBeNull();
  });
});

describe("gatewayChatUnitCostUsd", () => {
  it("blends input/output rates so units * rate equals the true split cost", () => {
    const rate = gatewayChatUnitCostUsd(4000, 2000);
    const expected = (4000 / 1e6) * 0.3 + (2000 / 1e6) * 2.5;
    expect(6000 * rate).toBeCloseTo(expected, 12);
  });

  it("returns 0 for empty usage", () => {
    expect(gatewayChatUnitCostUsd(0, 0)).toBe(0);
  });
});

describe("estimateTokens", () => {
  it("estimates ~4 chars per token with a floor of 1", () => {
    expect(estimateTokens("a".repeat(400))).toBe(100);
    expect(estimateTokens("")).toBe(1);
  });
});
