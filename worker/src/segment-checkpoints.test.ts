/**
 * F21 render checkpoint tests (run with: npx tsx --test src/*.test.ts).
 *
 * Covers:
 *  - parseSegmentCheckpoint: garbage degrades to {}, only `true` counts.
 *  - withSegmentDone: marks one segment, preserves sibling keys, no mutation.
 *  - isSegmentDone / firstIncompleteSegment: resume-point math.
 *  - readRenderCheckpoint / markSegmentDone: JSONB merge round-trip against a
 *    stubbed Supabase client (never throws; sibling keys survive).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  firstIncompleteSegment,
  isSegmentDone,
  parseSegmentCheckpoint,
  withSegmentDone,
} from "./segment-checkpoints.js";
import { markSegmentDone, readRenderCheckpoint } from "./supabase.js";
import type { SupabaseClient } from "@supabase/supabase-js";

/** The stub implements only the query surface these helpers touch. */
function asClient(stub: unknown): SupabaseClient {
  return stub as SupabaseClient;
}

describe("parseSegmentCheckpoint", () => {
  it("parses a segments map", () => {
    assert.deepEqual(parseSegmentCheckpoint({ segments: { 0: true, 2: true } }), {
      0: true,
      2: true,
    });
  });
  it("degrades garbage to {}", () => {
    for (const bad of [null, undefined, 42, "x", [], { segments: null }, { segments: [true] }]) {
      assert.deepEqual(parseSegmentCheckpoint(bad), {}, `input: ${JSON.stringify(bad)}`);
    }
  });
  it("ignores non-true values", () => {
    assert.deepEqual(parseSegmentCheckpoint({ segments: { 0: true, 1: false, 2: "yes" } }), {
      0: true,
    });
  });
});

describe("withSegmentDone", () => {
  it("marks the segment and preserves sibling keys", () => {
    const before = { segments: { 0: true }, storagePath: "u/renders/j.mp4" };
    const after = withSegmentDone(before, 1);
    assert.deepEqual(after, {
      segments: { 0: true, 1: true },
      storagePath: "u/renders/j.mp4",
    });
    // input untouched
    assert.deepEqual(before, { segments: { 0: true }, storagePath: "u/renders/j.mp4" });
  });
  it("starts from {} on garbage input", () => {
    assert.deepEqual(withSegmentDone(null, 0), { segments: { 0: true } });
  });
});

describe("resume math", () => {
  it("firstIncompleteSegment finds the gap", () => {
    assert.equal(firstIncompleteSegment(3, { 0: true, 2: true }), 1);
    assert.equal(firstIncompleteSegment(3, { 0: true, 1: true, 2: true }), null);
    assert.equal(firstIncompleteSegment(3, {}), 0);
  });
  it("isSegmentDone reads through the parser", () => {
    assert.equal(isSegmentDone({ segments: { 4: true } }, 4), true);
    assert.equal(isSegmentDone({ segments: { 4: true } }, 5), false);
    assert.equal(isSegmentDone(null, 0), false);
  });
});

// ── Stubbed Supabase for read/mark round-trip ───────────────────────────────

function stubRenders(initialCheckpoint: unknown) {
  let checkpoint: unknown = initialCheckpoint;
  const writes: unknown[] = [];
  const stub = {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: unknown) => ({
          maybeSingle: async () => ({ data: { checkpoint }, error: null }),
        }),
      }),
      update: (patch: { checkpoint: unknown }) => ({
        eq: async (_col: string, _val: unknown) => {
          checkpoint = patch.checkpoint;
          writes.push(patch.checkpoint);
          return { error: null };
        },
      }),
    }),
  };
  return { stub, writes, get: () => checkpoint };
}

describe("readRenderCheckpoint / markSegmentDone", () => {
  it("round-trips: marks segments while preserving sibling keys", async () => {
    const { stub, writes, get } = stubRenders({ storagePath: "u/renders/j.mp4" });
    await markSegmentDone(asClient(stub), "job-1", 0);
    await markSegmentDone(asClient(stub), "job-1", 2);
    assert.equal(writes.length, 2);
    assert.deepEqual(get(), {
      segments: { 0: true, 2: true },
      storagePath: "u/renders/j.mp4",
    });
    const read = await readRenderCheckpoint(asClient(stub), "job-1");
    assert.equal(isSegmentDone(read, 2), true);
    assert.equal(firstIncompleteSegment(3, parseSegmentCheckpoint(read)), 1);
  });

  it("read degrades to {} when the row is missing", async () => {
    const stub = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      }),
    };
    assert.deepEqual(await readRenderCheckpoint(asClient(stub), "job-1"), {});
  });

  it("mark never throws when the update fails (missed checkpoint only re-renders)", async () => {
    const stub = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { checkpoint: {} }, error: null }) }),
        }),
        update: () => ({ eq: async () => ({ error: { message: "boom" } }) }),
      }),
    };
    await markSegmentDone(asClient(stub), "job-1", 0); // must not throw
  });
});
