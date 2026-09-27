/**
 * Phase 4 Stream D: notification trigger tests.
 *
 * - Triggers are CONSUME-ONLY: they may read other streams' tables but the
 *   only write allowed is the notifications insert (asserted via ops log).
 * - Exactly-once: a second run with the same rows emits duplicates, not rows.
 * - Email follows the existing pattern: only when RESEND_API_KEY is set.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  notifyApprovalRequested,
  notifyBudgetAlerts,
  notifyExperimentConcluded,
  notifyPublishEvents,
  notifyQuotaWarnings,
  notifyRenderEvents,
  runAllNotificationTriggers,
} from "./notifications/triggers.server";
import { emitNotification } from "./notifications.server";
import { createMockAdmin, expectConsumeOnly } from "./comments/mock-admin";

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const RECENT = new Date(Date.now() - 60_000).toISOString();

function baseResponders(extra: Record<string, (op: string, payload?: unknown) => unknown> = {}) {
  return {
    generation_jobs: () => [
      {
        id: "job-1",
        user_id: "user-1",
        job_type: "video",
        status: "completed",
        updated_at: RECENT,
      },
    ],
    publish_jobs: () => [
      {
        id: "pj-1",
        user_id: "user-1",
        title: "My video",
        status: "published",
        updated_at: RECENT,
        approved_at: RECENT,
      },
    ],
    experiments: () => [
      {
        id: "exp-1",
        user_id: "user-1",
        name: "Thumbnail test",
        conclusion: { winner_arm_id: "arm-a", p_value: 0.03, decided_at: RECENT },
        updated_at: RECENT,
      },
    ],
    workspace_budgets: () => [],
    channel_connections: () => [],
    notifications: () => [], // no existing rows → first run emits
    ...extra,
  };
}

describe("consume-only contract", () => {
  it("runAllNotificationTriggers only writes notification rows", async () => {
    const { admin, ops } = createMockAdmin(baseResponders());
    const summary = await runAllNotificationTriggers(admin as never, "user-1");
    expect(summary.emitted).toBeGreaterThan(0);
    expectConsumeOnly(ops);
    const inserts = ops.filter((o) => o.table === "notifications" && o.op === "insert");
    expect(inserts.length).toBe(summary.emitted);
  });

  it("notifyRenderEvents maps completed/failed to the pinned dotted types", async () => {
    const { admin, ops } = createMockAdmin(
      baseResponders({
        generation_jobs: () => [
          {
            id: "job-1",
            user_id: "user-1",
            job_type: "video",
            status: "completed",
            updated_at: RECENT,
          },
          {
            id: "job-2",
            user_id: "user-1",
            job_type: "video",
            status: "failed",
            updated_at: RECENT,
          },
        ],
      }),
    );
    await notifyRenderEvents(admin as never, "user-1");
    const types = ops
      .filter((o) => o.table === "notifications" && o.op === "insert")
      .map((o) => (o.payload as { type: string }).type)
      .sort();
    expect(types).toEqual(["render.completed", "render.failed"]);
  });

  it("notifyApprovalRequested fires once per draft publish job", async () => {
    const { admin, ops } = createMockAdmin(
      baseResponders({
        publish_jobs: () => [
          { id: "pj-d", user_id: "user-1", title: "Needs review", created_at: RECENT },
        ],
      }),
    );
    const s = await notifyApprovalRequested(admin as never, "user-1");
    expect(s.emitted).toBe(1);
    const payload = ops.find((o) => o.table === "notifications" && o.op === "insert")!.payload as {
      type: string;
      dedup_key: string;
    };
    expect(payload.type).toBe("approval.requested");
    expect(payload.dedup_key).toBe("approval:pj-d");
  });

  it("notifyExperimentConcluded includes the p-value and the human-apply note", async () => {
    const { admin, ops } = createMockAdmin(baseResponders());
    await notifyExperimentConcluded(admin as never, "user-1");
    const payload = ops.find((o) => o.table === "notifications" && o.op === "insert")!.payload as {
      type: string;
      body: string;
    };
    expect(payload.type).toBe("experiment.concluded");
    expect(payload.body).toContain("p=0.0300");
    expect(payload.body).toMatch(/human/i);
  });

  it("notifyBudgetAlerts fires when spend crosses the threshold", async () => {
    const { admin, ops } = createMockAdmin(
      baseResponders({
        workspace_budgets: () => [
          { workspace_id: "ws-1", monthly_credit_cap: 100, alert_threshold_pct: 80 },
        ],
        generation_jobs: () => [{ cost_actual_credits: 50 }, { cost_actual_credits: 40 }],
      }),
    );
    const s = await notifyBudgetAlerts(admin as never, "user-1");
    expect(s.emitted).toBe(1);
    const payload = ops.find((o) => o.table === "notifications" && o.op === "insert")!.payload as {
      type: string;
    };
    expect(payload.type).toBe("budget.alert");
    expectConsumeOnly(ops);
  });

  it("notifyBudgetAlerts stays silent below the threshold", async () => {
    const { admin } = createMockAdmin(
      baseResponders({
        workspace_budgets: () => [
          { workspace_id: "ws-1", monthly_credit_cap: 100, alert_threshold_pct: 80 },
        ],
        generation_jobs: () => [{ cost_actual_credits: 10 }],
      }),
    );
    const s = await notifyBudgetAlerts(admin as never, "user-1");
    expect(s.emitted).toBe(0);
  });

  it("notifyQuotaWarnings fires at >= 80% of the daily YouTube unit quota", async () => {
    const { admin, ops } = createMockAdmin(
      baseResponders({
        channel_connections: () => [
          {
            id: "cc-1",
            display_name: "My channel",
            quota: { units: { used: 9000, limit: 10000 } },
          },
        ],
      }),
    );
    const s = await notifyQuotaWarnings(admin as never, "user-1");
    expect(s.emitted).toBe(1);
    expect(
      (
        ops.find((o) => o.table === "notifications" && o.op === "insert")!.payload as {
          type: string;
        }
      ).type,
    ).toBe("quota.warning");
  });
});

describe("exactly-once via dedup_key", () => {
  it("a second trigger run over the same rows emits duplicates, not new rows", async () => {
    const { admin } = createMockAdmin(baseResponders());
    const first = await notifyPublishEvents(admin as never, "user-1");
    expect(first.emitted).toBe(1);

    // Simulate the stored row now existing.
    const { admin: admin2 } = createMockAdmin(
      baseResponders({
        notifications: () => [{ id: "n-1" }],
      }),
    );
    const second = await notifyPublishEvents(admin2 as never, "user-1");
    expect(second.emitted).toBe(0);
    expect(second.duplicates).toBe(1);
  });

  it("emitNotification treats a 23505 race as a duplicate", async () => {
    const { admin, ops } = createMockAdmin({ notifications: () => [] });
    const origFrom = admin.from.bind(admin);
    // Dedup SELECT finds nothing, but the insert hits the partial unique
    // index because another worker won the race.
    (admin as { from: unknown }).from = (tableName: string) => {
      if (tableName !== "notifications") return origFrom(tableName);
      return {
        select: () => ({
          eq: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }),
        }),
        insert: async (payload: unknown) => {
          (ops as { push: (o: unknown) => void }).push({ table: tableName, op: "insert", payload });
          return { error: { code: "23505", message: "duplicate key value" } };
        },
      };
    };
    const r = await emitNotification(admin as never, {
      userId: "user-1",
      type: "render.completed",
      title: "done",
      dedupKey: "render:job-1",
    });
    expect(r.duplicate).toBe(true);
    expect(r.notified).toBe(false);
  });
});

describe("email gating", () => {
  it("does not email when RESEND_API_KEY is missing (existing pattern kept)", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { admin } = createMockAdmin({ notifications: () => [] });
    const r = await emitNotification(admin as never, {
      userId: "user-1",
      type: "render.completed",
      title: "done",
      email: { to: "user@example.com", subject: "s", text: "t" },
    });
    expect(r.notified).toBe(true);
    expect(r.emailed).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("emails when RESEND_API_KEY is configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const fetch = vi.fn(
      async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response,
    );
    vi.stubGlobal("fetch", fetch);
    const { admin } = createMockAdmin({ notifications: () => [] });
    const r = await emitNotification(admin as never, {
      userId: "user-1",
      type: "publish.published",
      title: "live",
      email: { to: "user@example.com", subject: "s", text: "t" },
    });
    expect(r.emailed).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.to).toEqual(["user@example.com"]);
  });
});
