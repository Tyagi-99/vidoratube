import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "./http.server";
import { withProviderTelemetry } from "./telemetry.server";
import type { CostCtx } from "../api-cost";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("withProviderTelemetry", () => {
  it("returns the success envelope with output, model, usage and cost", async () => {
    const result = await withProviderTelemetry(async () => "hello", {
      provider: "test",
      operation: "op",
      model: "m-1",
      taskId: "t-1",
      estimate: { units: 4, unitCostUsd: 0.5 },
      usage: { characters: 4 },
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe("ok");
    expect(result.output).toBe("hello");
    expect(result.model).toBe("m-1");
    expect(result.taskId).toBe("t-1");
    expect(result.error).toBeNull();
    expect(result.usage).toEqual({ characters: 4 });
    expect(result.estimatedCost).toBe(2);
    expect(result.actualCost).toBe(2);
    expect(result.costCurrency).toBe("credits");
  });

  it("measures latency (slow call reports more than fast call)", async () => {
    const fast = await withProviderTelemetry(async () => 1, {
      provider: "test",
      operation: "op",
    });
    const slow = await withProviderTelemetry(() => sleep(60).then(() => 1), {
      provider: "test",
      operation: "op",
    });
    expect(fast.latencyMs).toBeGreaterThanOrEqual(0);
    expect(slow.latencyMs).toBeGreaterThanOrEqual(fast.latencyMs);
    expect(slow.latencyMs).toBeGreaterThanOrEqual(40);
  });

  it("captures thrown errors into the envelope and never throws", async () => {
    const result = await withProviderTelemetry(
      async () => {
        throw new Error("boom");
      },
      { provider: "test", operation: "op" },
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe("error");
    expect(result.output).toBeNull();
    expect(result.error).toMatchObject({ code: "unknown", message: "boom" });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("classifies provider errors (rate limit, auth, timeout)", async () => {
    const mk = (fn: () => Promise<never>) =>
      withProviderTelemetry(fn, { provider: "test", operation: "op" });

    const limited = await mk(async () => {
      throw new ProviderError("P", 429, "slow down");
    });
    expect(limited.error?.code).toBe("rate_limited");

    const auth = await mk(async () => {
      throw new ProviderError("P", 401, "bad key");
    });
    expect(auth.error?.code).toBe("auth");

    const timeout = await mk(async () => {
      throw new ProviderError("P", 0, "request timed out");
    });
    expect(timeout.error?.code).toBe("timeout");
  });

  it("short-circuits when unconfigured: provider never invoked", async () => {
    const fn = vi.fn(async () => "should never run");
    const result = await withProviderTelemetry(fn, {
      provider: "test",
      operation: "op",
      configured: false,
    });
    expect(fn).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.status).toBe("unconfigured");
    expect(result.output).toBeNull();
    expect(result.latencyMs).toBe(0);
    expect(result.error?.code).toBe("unconfigured");
    expect(result.estimatedCost).toBeNull();
  });

  it("records the measured cost to api_usage when a cost context is given", async () => {
    const insert = vi.fn(async (_row: unknown) => ({ error: null }));
    const admin = { from: () => ({ insert }) } as unknown as CostCtx["admin"];
    const costCtx: CostCtx = { admin, userId: "user-1", projectId: "proj-1" };

    const result = await withProviderTelemetry(async () => new ArrayBuffer(8), {
      provider: "elevenlabs",
      operation: "tts",
      model: "eleven_flash_v2_5",
      estimate: { units: 1000, unitCostUsd: 0.05 / 1000 },
      usage: { characters: 1000 },
      meta: { job_id: "job-1" },
      costCtx,
    });

    expect(result.ok).toBe(true);
    expect(insert).toHaveBeenCalledTimes(1);
    const row = insert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      user_id: "user-1",
      project_id: "proj-1",
      provider: "elevenlabs",
      operation: "tts",
      units: 1000,
    });
    expect(row["estimated_cost"]).toBeCloseTo(0.05, 10);
    const meta = row["meta"] as Record<string, unknown>;
    expect(meta["job_id"]).toBe("job-1");
    expect(meta["model"]).toBe("eleven_flash_v2_5");
    expect(typeof meta["latency_ms"]).toBe("number");
  });

  it("does not record cost rows for failed calls", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const admin = { from: () => ({ insert }) } as unknown as CostCtx["admin"];
    const result = await withProviderTelemetry(
      async () => {
        throw new Error("nope");
      },
      {
        provider: "elevenlabs",
        operation: "tts",
        estimate: { units: 1000, unitCostUsd: 0.05 / 1000 },
        costCtx: { admin, userId: "user-1" },
      },
    );
    expect(result.ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });
});
