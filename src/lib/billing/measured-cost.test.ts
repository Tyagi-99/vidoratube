import { describe, expect, it } from "vitest";
import {
  measuredCostPerMinute,
  planMargins,
  MEASURED_WINDOW_DAYS,
} from "./measured-cost";

/**
 * Sprint 1: measured cost queries.
 *
 * Pure-logic tests against a mocked Supabase admin client (chainable query
 * builder that resolves to fixture rows). Covers mode attribution,
 * divide-by-zero guards, ledger netting of reserves/refunds, and the
 * estimate caveats.
 */

function mockAdmin(tables: Record<string, unknown[]>) {
  return {
    from(table: string) {
      const rows = tables[table] ?? [];
      const proxy: unknown = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === "then") {
              // Awaited directly: resolve with this table's rows.
              return (resolve: (v: unknown) => void) =>
                resolve({ data: rows, error: null });
            }
            return (..._args: unknown[]) => proxy;
          },
        },
      );
      return proxy;
    },
  } as never;
}

const recent = new Date().toISOString();

describe("measuredCostPerMinute", () => {
  it("attributes costs and minutes by billing mode", async () => {
    const admin = mockAdmin({
      api_usage: [
        { estimated_cost: 0.1, meta: { mode: "story" }, operation: "tts" },
        { estimated_cost: 0.2, meta: { mode: "story" }, operation: "image" },
        { estimated_cost: 5.0, meta: { mode: "cinema" }, operation: "image" },
        { estimated_cost: 0.05, meta: null, operation: "llm_plan" }, // -> story default
      ],
      video_jobs: [
        { duration_seconds: 120 }, // 2 min, story
        { duration_seconds: 60 }, // 1 min, story
      ],
      renders: [
        { billed_minutes: 4, meta: { mode: "story" } },
        { billed_minutes: 10, meta: { mode: "cinema" } },
        { billed_minutes: 2, meta: null }, // -> story default
      ],
    });

    const story = await measuredCostPerMinute(admin, "story");
    expect(story.mode).toBe("story");
    expect(story.windowDays).toBe(MEASURED_WINDOW_DAYS);
    expect(story.totalCostUsd).toBeCloseTo(0.35, 6);
    expect(story.costRows).toBe(3);
    // 3 min from video_jobs + 4 + 2 from story renders
    expect(story.finishedMinutes).toBeCloseTo(9, 6);
    expect(story.jobsCounted).toBe(4);
    expect(story.costPerMinuteUsd).toBeCloseTo(0.35 / 9, 3);

    const cinema = await measuredCostPerMinute(admin, "cinema");
    expect(cinema.totalCostUsd).toBeCloseTo(5.0, 6);
    expect(cinema.finishedMinutes).toBeCloseTo(10, 6);
    expect(cinema.costPerMinuteUsd).toBeCloseTo(0.5, 6);
  });

  it("returns null cost-per-minute when nothing finished (divide-by-zero guard)", async () => {
    const admin = mockAdmin({
      api_usage: [{ estimated_cost: 0.1, meta: { mode: "story" }, operation: "tts" }],
      video_jobs: [],
      renders: [],
    });
    const result = await measuredCostPerMinute(admin, "story");
    expect(result.finishedMinutes).toBe(0);
    expect(result.costPerMinuteUsd).toBeNull();
    expect(result.totalCostUsd).toBeCloseTo(0.1, 6);
  });

  it("handles completely empty data", async () => {
    const admin = mockAdmin({});
    const result = await measuredCostPerMinute(admin, "cinema");
    expect(result.totalCostUsd).toBe(0);
    expect(result.costPerMinuteUsd).toBeNull();
    expect(result.costRows).toBe(0);
    expect(result.jobsCounted).toBe(0);
  });

  it("propagates query errors", async () => {
    const admin = {
      from() {
        return {
          select: () => ({
            gte: () => ({
              in: () => Promise.resolve({ data: null, error: new Error("boom") }),
            }),
          }),
        };
      },
    } as never;
    await expect(measuredCostPerMinute(admin, "story")).rejects.toThrow("boom");
  });
});

describe("planMargins", () => {
  it("nets reserves, overages, and refunds to true credits consumed", async () => {
    const admin = mockAdmin({
      plans: [
        {
          slug: "creator",
          name: "Creator",
          kind: "subscription",
          credits_granted: 600,
          price_usd_cents: 2900,
        },
        {
          slug: "studio",
          name: "Studio",
          kind: "subscription",
          credits_granted: 2000,
          price_usd_cents: 7900,
        },
      ],
      api_usage: [
        { estimated_cost: 1.0, operation: "tts" },
        { estimated_cost: 2.0, operation: "image" },
        { estimated_cost: 3.0, operation: "render_shotstack" },
      ],
      credit_ledger: [
        // Reserve 10, overage 2, refund 6 (under-run) -> net consumed 6
        { delta: -10, reason: "Server render reserve (10 credits)", created_at: recent },
        { delta: -2, reason: "Server render overage (2 min)", created_at: recent },
        { delta: 6, reason: "Refund: queued render cancelled", created_at: recent },
        // Unrelated credit spend must not leak in via the fixture (the real
        // query filters reason ILIKE %render%; the fixture is pre-filtered).
      ],
    });

    const margins = await planMargins(admin);
    expect(margins.windowDays).toBe(MEASURED_WINDOW_DAYS);
    expect(margins.providerCostUsd).toBeCloseTo(6.0, 6);
    expect(margins.creditsConsumed).toBeCloseTo(6, 6);
    // $6 of provider cost over 6 consumed credits = $1/credit.
    expect(margins.costPerCreditUsd).toBeCloseTo(1, 6);

    const creator = margins.plans.find((p) => p.slug === "creator")!;
    expect(creator.priceUsd).toBe(29);
    expect(creator.creditsGranted).toBe(600);
    expect(creator.estCostUsd).toBe(600);
    expect(creator.marginUsd).toBe(29 - 600);
    expect(creator.marginPct).toBeCloseTo((29 - 600) / 29, 3);
  });

  it("returns nulls when nothing was consumed", async () => {
    const admin = mockAdmin({
      plans: [
        {
          slug: "creator",
          name: "Creator",
          kind: "subscription",
          credits_granted: 600,
          price_usd_cents: 2900,
        },
      ],
      api_usage: [],
      credit_ledger: [],
    });
    const margins = await planMargins(admin);
    expect(margins.costPerCreditUsd).toBeNull();
    expect(margins.creditsConsumed).toBe(0);
    const creator = margins.plans[0]!;
    expect(creator.estCostUsd).toBeNull();
    expect(creator.marginUsd).toBeNull();
    expect(creator.marginPct).toBeNull();
    // Price is still known from the DB plan row.
    expect(creator.priceUsd).toBe(29);
  });

  it("tolerates plans without a USD price", async () => {
    const admin = mockAdmin({
      plans: [
        {
          slug: "free",
          name: "Free",
          kind: "free",
          credits_granted: 30,
          price_usd_cents: null,
        },
      ],
      api_usage: [{ estimated_cost: 1.0, operation: "tts" }],
      credit_ledger: [{ delta: -2, reason: "Video render (2 finished min)", created_at: recent }],
    });
    const margins = await planMargins(admin);
    const free = margins.plans[0]!;
    expect(free.priceUsd).toBeNull();
    expect(free.estCostUsd).toBeCloseTo(15, 6); // 30 credits * $0.50
    expect(free.marginUsd).toBeNull();
  });
});
