import { describe, expect, it } from "vitest";
import {
  canFinalizeJobStage,
  claimJobStage,
  isReapableJob,
  REAP_AFTER_MS,
  releaseJobStageClaim,
} from "./stage-claim";

/** Minimal chainable stub of the supabase query builder used by the guards. */
function makeClient(result: { data: unknown; error: unknown }, seen: unknown[][]) {
  const chain: Record<string, (...args: unknown[]) => unknown> = {
    update: (patch: unknown) => {
      seen.push(["update", patch]);
      return chain;
    },
    eq: (col: unknown, val: unknown) => {
      seen.push(["eq", col, val]);
      return chain;
    },
    not: (col: unknown, op: unknown, val: unknown) => {
      seen.push(["not", col, op, val]);
      return chain;
    },
    select: (...args: unknown[]) => {
      seen.push(["select", ...args]);
      return chain;
    },
    maybeSingle: async () => result,
  };
  return {
    from: (table: unknown) => {
      seen.push(["from", table]);
      return chain;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("claimJobStage", () => {
  it("claims with a conditional update and returns the claimed row", async () => {
    const seen: unknown[][] = [];
    const claimed = { id: "j1", stage: "voiceover_claimed" };
    const client = makeClient({ data: claimed, error: null }, seen);
    const row = await claimJobStage(client, "j1", "u1", "voiceover");

    expect(row).toEqual(claimed);
    expect(seen).toContainEqual(["from", "video_jobs"]);
    expect(seen).toContainEqual(["update", { stage: "voiceover_claimed", step: "Working" }]);
    expect(seen).toContainEqual(["eq", "id", "j1"]);
    expect(seen).toContainEqual(["eq", "user_id", "u1"]);
    expect(seen).toContainEqual(["eq", "stage", "voiceover"]);
    // Never claim a job that already resolved.
    expect(seen).toContainEqual(["not", "status", "in", "(completed,failed)"]);
  });

  it("returns null when another caller won the race", async () => {
    const seen: unknown[][] = [];
    const client = makeClient({ data: null, error: null }, seen);
    const row = await claimJobStage(client, "j1", "u1", "visuals");
    expect(row).toBeNull();
  });

  it("throws on query errors", async () => {
    const client = makeClient({ data: null, error: { message: "boom" } }, []);
    await expect(claimJobStage(client, "j1", "u1", "render")).rejects.toThrow("boom");
  });
});

describe("releaseJobStageClaim", () => {
  it("resets the stage back only when it still holds our claim", async () => {
    const seen: unknown[][] = [];
    const client = makeClient({ data: null, error: null }, seen);
    await releaseJobStageClaim(client, "j1", "u1", "render");

    expect(seen).toContainEqual(["update", { stage: "render" }]);
    expect(seen).toContainEqual(["eq", "stage", "render_claimed"]);
    expect(seen).toContainEqual(["eq", "id", "j1"]);
    expect(seen).toContainEqual(["eq", "user_id", "u1"]);
  });
});

describe("isReapableJob", () => {
  const base = { status: "running", stage: "voiceover", updated_at: "" };

  it("reaps running jobs older than the threshold", () => {
    const updated = new Date(Date.now() - REAP_AFTER_MS - 1000).toISOString();
    expect(isReapableJob({ ...base, updated_at: updated })).toBe(true);
  });

  it("leaves fresh running jobs alone", () => {
    const updated = new Date(Date.now() - 1000).toISOString();
    expect(isReapableJob({ ...base, updated_at: updated })).toBe(false);
  });

  it("never reaps completed jobs or terminal stages", () => {
    const updated = new Date(Date.now() - REAP_AFTER_MS - 1000).toISOString();
    expect(isReapableJob({ ...base, status: "completed", updated_at: updated })).toBe(false);
    expect(isReapableJob({ ...base, status: "failed", updated_at: updated })).toBe(false);
    expect(isReapableJob({ ...base, stage: "done", updated_at: updated })).toBe(false);
  });

  it("rejects unparseable timestamps", () => {
    expect(isReapableJob({ ...base, updated_at: "not-a-date" })).toBe(false);
  });
});

describe("canFinalizeJobStage", () => {
  it("allows running jobs in client-compose stages", () => {
    expect(canFinalizeJobStage({ status: "running", stage: "client_render" })).toBe(true);
    expect(canFinalizeJobStage({ status: "running", stage: "preview" })).toBe(true);
  });

  it("blocks jobs still in the paid pipeline", () => {
    for (const stage of ["planning", "voiceover", "visuals", "render", "rendering"]) {
      expect(canFinalizeJobStage({ status: "running", stage })).toBe(false);
    }
  });

  it("blocks non-running jobs even in compose stages", () => {
    expect(canFinalizeJobStage({ status: "completed", stage: "client_render" })).toBe(false);
    expect(canFinalizeJobStage({ status: "failed", stage: "preview" })).toBe(false);
  });
});
