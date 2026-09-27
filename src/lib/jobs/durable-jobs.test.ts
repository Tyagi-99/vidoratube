/**
 * Unit tests for the durable generation-jobs state machine
 * (src/lib/jobs/durable-jobs.server.ts).
 *
 * The supabase client is a thenable chain stub: every awaited query (or rpc
 * call) consumes the next queued {data, error} response, and every call is
 * recorded so tests can assert the exact conditional UPDATE … WHERE …
 * guards the state machine relies on for race safety.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  claimGenerationJob,
  completeGenerationJob,
  createGenerationJob,
  failGenerationJob,
  getJobCostSummary,
  recordProviderTask,
  resumeGenerationJob,
  saveCheckpoint,
} from "./durable-jobs.server";

interface Scripted {
  data: unknown;
  error: unknown;
}

function makeMockDb() {
  const calls: unknown[][] = [];
  const queue: Scripted[] = [];

  const chain = new Proxy({} as Record<string, unknown>, {
    get(_t, prop: string) {
      if (prop === "then") {
        // PostgREST builders are thenable: awaiting the chain resolves the
        // next scripted response.
        return (resolve: (v: Scripted) => void) => {
          resolve(queue.shift() ?? { data: null, error: null });
        };
      }
      return (...args: unknown[]) => {
        calls.push([prop, ...args]);
        return chain;
      };
    },
  });

  const client = {
    from: (table: string) => {
      calls.push(["from", table]);
      return chain;
    },
    rpc: (fn: string, params: unknown) => {
      calls.push(["rpc", fn, params]);
      return Promise.resolve(queue.shift() ?? { data: null, error: null });
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as SupabaseClient<Database>;

  return { client, calls, queue };
}

const JOB = {
  id: "job-1",
  user_id: "user-1",
  workspace_id: null,
  project_id: "proj-1",
  job_type: "server_render",
  status: "queued",
  idempotency_key: "key-1",
  attempt_count: 0,
  max_attempts: 3,
  checkpoint: {},
  cost_estimate_credits: 10,
  cost_actual_credits: null,
  provider: "server_ffmpeg",
  model: "story",
  provider_task_id: null,
  error: null,
  created_at: "2026-09-27T00:00:00Z",
  updated_at: "2026-09-27T00:00:00Z",
};

function updatePatch(calls: unknown[][]): Record<string, unknown> {
  const call = calls.find((c) => c[0] === "update");
  expect(call, "expected an update call").toBeDefined();
  return call![1] as Record<string, unknown>;
}

function insertRow(calls: unknown[][]): Record<string, unknown> {
  const call = calls.find((c) => c[0] === "insert");
  expect(call, "expected an insert call").toBeDefined();
  return call![1] as Record<string, unknown>;
}

describe("createGenerationJob", () => {
  it("returns the existing row when the idempotency key was seen before (no double-create)", async () => {
    const { client, calls, queue } = makeMockDb();
    queue.push({ data: JOB, error: null });

    const row = await createGenerationJob(client, {
      userId: "user-1",
      projectId: "proj-1",
      jobType: "server_render",
      idempotencyKey: "key-1",
    });

    expect(row).toEqual(JOB);
    expect(calls).toContainEqual(["from", "generation_jobs"]);
    expect(calls).toContainEqual(["eq", "user_id", "user-1"]);
    expect(calls).toContainEqual(["eq", "idempotency_key", "key-1"]);
    expect(calls.some((c) => c[0] === "insert")).toBe(false);
  });

  it("inserts a new queued job with estimate and defaults when no key is given", async () => {
    const { client, calls, queue } = makeMockDb();
    queue.push({ data: { ...JOB, idempotency_key: null }, error: null });

    await createGenerationJob(client, {
      userId: "user-1",
      jobType: "tts",
      costEstimateCredits: 4,
    });

    const row = insertRow(calls);
    expect(row).toMatchObject({
      user_id: "user-1",
      job_type: "tts",
      status: "queued",
      idempotency_key: null,
      attempt_count: 0,
      max_attempts: 3,
      checkpoint: {},
      cost_estimate_credits: 4,
    });
  });

  it("recovers from a 23505 insert race by returning the row the other caller created", async () => {
    const { client, queue } = makeMockDb();
    queue.push({ data: null, error: null }); // pre-select miss
    queue.push({ data: null, error: { code: "23505", message: "duplicate key" } });
    queue.push({ data: JOB, error: null }); // re-select finds the winner

    const row = await createGenerationJob(client, {
      userId: "user-1",
      jobType: "server_render",
      idempotencyKey: "key-1",
    });
    expect(row).toEqual(JOB);
  });

  it("throws a conflict instead of returning another user's row on a 23505", async () => {
    const { client, queue } = makeMockDb();
    queue.push({ data: null, error: null });
    queue.push({ data: null, error: { code: "23505", message: "duplicate key" } });
    queue.push({ data: { ...JOB, user_id: "user-2" }, error: null });

    await expect(
      createGenerationJob(client, {
        userId: "user-1",
        jobType: "server_render",
        idempotencyKey: "key-1",
      }),
    ).rejects.toThrow("another user");
  });
});

describe("claimGenerationJob", () => {
  it("atomically transitions queued→running with an attempt increment and records the worker", async () => {
    const { client, calls, queue } = makeMockDb();
    queue.push({
      data: { ...JOB, status: "queued", attempt_count: 1, max_attempts: 3, checkpoint: {} },
      error: null,
    });
    const claimed = { ...JOB, status: "running", attempt_count: 2 };
    queue.push({ data: claimed, error: null });

    const row = await claimGenerationJob(client, "job-1", "worker-9");

    expect(row).toEqual(claimed);
    const patch = updatePatch(calls);
    expect(patch).toMatchObject({ status: "running", attempt_count: 2 });
    // The worker id is recorded in the checkpoint claim namespace.
    expect(patch["checkpoint"]).toMatchObject({
      __claim: { worker_id: "worker-9", attempt: 2 },
    });
    // The atomic gate: only a still-queued job at the read attempt count.
    expect(calls).toContainEqual(["eq", "id", "job-1"]);
    expect(calls).toContainEqual(["eq", "status", "queued"]);
    expect(calls).toContainEqual(["eq", "attempt_count", 1]);
  });

  it("returns null when another worker won the race", async () => {
    const { client, queue } = makeMockDb();
    queue.push({
      data: { ...JOB, status: "queued", attempt_count: 0, max_attempts: 3 },
      error: null,
    });
    queue.push({ data: null, error: null }); // UPDATE matched zero rows

    const row = await claimGenerationJob(client, "job-1", "worker-9");
    expect(row).toBeNull();
  });

  it("refuses to claim past max_attempts", async () => {
    const { client, calls, queue } = makeMockDb();
    queue.push({
      data: { ...JOB, status: "queued", attempt_count: 3, max_attempts: 3 },
      error: null,
    });

    const row = await claimGenerationJob(client, "job-1", "worker-9");
    expect(row).toBeNull();
    expect(calls.some((c) => c[0] === "update")).toBe(false);
  });

  it("refuses to claim a job that is not queued", async () => {
    const { client, calls, queue } = makeMockDb();
    queue.push({
      data: { ...JOB, status: "running", attempt_count: 1, max_attempts: 3 },
      error: null,
    });

    const row = await claimGenerationJob(client, "job-1", "worker-9");
    expect(row).toBeNull();
    expect(calls.some((c) => c[0] === "update")).toBe(false);
  });
});

describe("saveCheckpoint", () => {
  it("deep-merges checkpoint JSON and marks the job checkpointed", async () => {
    const { client, calls, queue } = makeMockDb();
    queue.push({
      data: {
        ...JOB,
        status: "running",
        checkpoint: { stages: { a: { done: true } }, list: [1] },
      },
      error: null,
    });
    queue.push({ data: { ...JOB, status: "checkpointed" }, error: null });

    const row = await saveCheckpoint(client, "job-1", {
      stages: { b: { done: false } },
      list: [2],
    } as never);

    expect(row).not.toBeNull();
    const patch = updatePatch(calls);
    expect(patch["status"]).toBe("checkpointed");
    // Deep merge: sibling stage "a" survives; arrays replace wholesale.
    expect(patch["checkpoint"]).toEqual({
      stages: { a: { done: true }, b: { done: false } },
      list: [2],
    });
    expect(calls).toContainEqual(["in", "status", ["running", "checkpointed"]]);
  });

  it("returns null for a job that is not running or checkpointed", async () => {
    const { client, calls, queue } = makeMockDb();
    queue.push({ data: { ...JOB, status: "completed" }, error: null });

    const row = await saveCheckpoint(client, "job-1", { x: 1 } as never);
    expect(row).toBeNull();
    expect(calls.some((c) => c[0] === "update")).toBe(false);
  });
});

describe("resumeGenerationJob", () => {
  it("moves checkpointed→queued and returns the stored checkpoint", async () => {
    const { client, calls, queue } = makeMockDb();
    const checkpoint = { stages: { visuals: { done: false } } };
    queue.push({
      data: { ...JOB, status: "checkpointed", checkpoint, attempt_count: 1 },
      error: null,
    });
    queue.push({ data: { ...JOB, status: "queued", checkpoint }, error: null });

    const result = await resumeGenerationJob(client, "job-1");

    expect(result).not.toBeNull();
    expect(result!.job.status).toBe("queued");
    expect(result!.checkpoint).toEqual(checkpoint);
    expect(calls).toContainEqual(["eq", "status", "checkpointed"]);
    expect(updatePatch(calls)).toMatchObject({ status: "queued" });
  });

  it("moves failed→queued when attempts remain", async () => {
    const { client, queue } = makeMockDb();
    queue.push({
      data: { ...JOB, status: "failed", attempt_count: 1, max_attempts: 3 },
      error: null,
    });
    queue.push({ data: { ...JOB, status: "queued" }, error: null });

    const result = await resumeGenerationJob(client, "job-1");
    expect(result).not.toBeNull();
    expect(result!.job.status).toBe("queued");
  });

  it("leaves a failed job failed when the attempt budget is exhausted", async () => {
    const { client, calls, queue } = makeMockDb();
    queue.push({
      data: { ...JOB, status: "failed", attempt_count: 3, max_attempts: 3 },
      error: null,
    });

    const result = await resumeGenerationJob(client, "job-1");
    expect(result).toBeNull();
    expect(calls.some((c) => c[0] === "update")).toBe(false);
  });
});

describe("completeGenerationJob", () => {
  it("accumulates cost_actual_credits from provider_tasks.cost_actual", async () => {
    const { client, calls, queue } = makeMockDb();
    queue.push({
      data: [{ cost_actual: 2 }, { cost_actual: 1.5 }, { cost_actual: null }],
      error: null,
    });
    queue.push({ data: { ...JOB, status: "completed" }, error: null });

    const row = await completeGenerationJob(client, "job-1");

    expect(row).not.toBeNull();
    const patch = updatePatch(calls);
    expect(patch).toMatchObject({ status: "completed", cost_actual_credits: 3.5 });
    // Terminal guard: only a non-terminal job may complete.
    expect(calls).toContainEqual(["in", "status", ["queued", "running", "checkpointed"]]);
  });

  it("adds the explicit cost param on top of the measured task sum", async () => {
    const { client, calls, queue } = makeMockDb();
    queue.push({ data: [{ cost_actual: 3.5 }], error: null });
    queue.push({ data: { ...JOB, status: "completed" }, error: null });

    await completeGenerationJob(client, "job-1", { costActualCredits: 1 });
    expect(updatePatch(calls)).toMatchObject({ cost_actual_credits: 4.5 });
  });

  it("does not re-complete an already terminal job", async () => {
    const { client, queue } = makeMockDb();
    queue.push({ data: [], error: null });
    queue.push({ data: null, error: null }); // conditional UPDATE matched nothing

    const row = await completeGenerationJob(client, "job-1");
    expect(row).toBeNull();
  });
});

describe("failGenerationJob", () => {
  const failedRow = { ...JOB, status: "failed", cost_estimate_credits: 5 };

  it("marks the job failed, stores the error, and refunds the debited minutes", async () => {
    const { client, calls, queue } = makeMockDb();
    queue.push({ data: failedRow, error: null });
    queue.push({ data: 9, error: null }); // refund RPC

    const row = await failGenerationJob(client, "job-1", { message: "boom" } as never);

    expect(row).toEqual(failedRow);
    expect(updatePatch(calls)).toMatchObject({
      status: "failed",
      error: { message: "boom" },
    });
    const rpc = calls.find((c) => c[0] === "rpc");
    expect(rpc?.[1]).toBe("refund_credits_for_minutes");
    expect(rpc?.[2]).toMatchObject({ p_user_id: "user-1", p_ref_id: "job-1" });
  });

  it("never masks the failure marking when the refund RPC throws", async () => {
    const { client, queue } = makeMockDb();
    queue.push({ data: failedRow, error: null });
    queue.push({ data: null, error: { message: "rpc blew up" } });

    const row = await failGenerationJob(client, "job-1", { message: "boom" } as never);
    expect(row).toEqual(failedRow);
  });

  it("does not touch an already terminal job (and never refunds)", async () => {
    const { client, calls, queue } = makeMockDb();
    queue.push({ data: null, error: null });

    const row = await failGenerationJob(client, "job-1", { message: "x" } as never);
    expect(row).toBeNull();
    expect(calls.some((c) => c[0] === "rpc")).toBe(false);
  });
});

describe("recordProviderTask", () => {
  it("updates the existing task for the (job_id, provider, attempt) key", async () => {
    const { client, calls, queue } = makeMockDb();
    const existing = {
      id: "pt-1",
      job_id: "job-1",
      provider: "elevenlabs",
      attempt: 1,
      status: "succeeded",
    };
    queue.push({ data: existing, error: null });

    const row = await recordProviderTask(client, {
      jobId: "job-1",
      provider: "elevenlabs",
      providerTaskId: "ext-123",
      attempt: 1,
      outputRef: "storage/audio.mp3",
      costActual: 0.4,
    });

    expect(row).toEqual(existing);
    expect(calls).toContainEqual(["eq", "job_id", "job-1"]);
    expect(calls).toContainEqual(["eq", "provider", "elevenlabs"]);
    expect(calls).toContainEqual(["eq", "attempt", 1]);
    expect(calls.some((c) => c[0] === "insert")).toBe(false);
    expect(updatePatch(calls)).toMatchObject({
      provider_task_id: "ext-123",
      status: "succeeded",
      cost_actual: 0.4,
      output_ref: "storage/audio.mp3",
    });
  });

  it("inserts when no task exists for the attempt key, deriving status from the provider task id", async () => {
    const { client, calls, queue } = makeMockDb();
    queue.push({ data: null, error: null }); // update matched nothing
    const created = { id: "pt-2", job_id: "job-1", provider: "fal", attempt: 1 };
    queue.push({ data: created, error: null });

    const row = await recordProviderTask(client, {
      jobId: "job-1",
      provider: "fal",
      model: "kling-2.0",
      providerTaskId: "fal-task-9",
      costEstimate: 6,
      latencyMs: 1200,
    });

    expect(row).toEqual(created);
    expect(insertRow(calls)).toMatchObject({
      job_id: "job-1",
      provider: "fal",
      model: "kling-2.0",
      provider_task_id: "fal-task-9",
      attempt: 1,
      status: "submitted",
      cost_estimate: 6,
      latency_ms: 1200,
    });
  });

  it("derives failed status from an error payload, never reporting unknown work as succeeded", async () => {
    const { client, calls, queue } = makeMockDb();
    queue.push({ data: null, error: null });
    queue.push({ data: { id: "pt-3" }, error: null });

    await recordProviderTask(client, {
      jobId: "job-1",
      provider: "elevenlabs",
      error: { message: "quota exceeded" } as never,
    });

    expect(insertRow(calls)).toMatchObject({ status: "failed" });
  });
});

describe("getJobCostSummary", () => {
  it("returns estimate vs live actual with the overrun", async () => {
    const { client, queue } = makeMockDb();
    queue.push({
      data: {
        id: "job-1",
        status: "running",
        cost_estimate_credits: 10,
        cost_actual_credits: null,
      },
      error: null,
    });
    queue.push({ data: [{ cost_actual: 4 }, { cost_actual: 3 }], error: null });

    const summary = await getJobCostSummary(client, "job-1");

    expect(summary).toEqual({
      jobId: "job-1",
      status: "running",
      estimateCredits: 10,
      actualCreditsLive: 7,
      finalizedActualCredits: null,
      overrunCredits: -3,
      taskCount: 2,
    });
  });

  it("returns null for an unknown job", async () => {
    const { client, queue } = makeMockDb();
    queue.push({ data: null, error: null });

    expect(await getJobCostSummary(client, "nope")).toBeNull();
  });
});
