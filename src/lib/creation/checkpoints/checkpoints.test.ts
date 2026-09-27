import { describe, expect, it } from "vitest";
import type { Json } from "@/integrations/supabase/types";
import {
  STUDIO_CHECKPOINT_KEY,
  firstIncompleteSceneId,
  getStudioCheckpoint,
  invalidateSceneCheckpoint,
  markSceneComplete,
  markSceneFailed,
  sceneCheckpointState,
  summarizeCheckpoint,
  type StudioCheckpoint,
} from "./checkpoints";

const IDS = ["scene-1", "scene-2", "scene-3"];

function checkpointFor(subtree: StudioCheckpoint | null): Json {
  return JSON.parse(JSON.stringify({ [STUDIO_CHECKPOINT_KEY]: subtree })) as Json;
}

describe("getStudioCheckpoint", () => {
  it("returns null for absent or malformed checkpoints", () => {
    expect(getStudioCheckpoint(null)).toBeNull();
    expect(getStudioCheckpoint(undefined)).toBeNull();
    expect(getStudioCheckpoint({ other: 1 })).toBeNull();
    expect(getStudioCheckpoint({ [STUDIO_CHECKPOINT_KEY]: "nope" })).toBeNull();
  });

  it("tolerates malformed scene entries", () => {
    const cp = getStudioCheckpoint({
      [STUDIO_CHECKPOINT_KEY]: {
        version: 1,
        scenes: {
          good: { status: "done", durationSec: 4 },
          bad: { status: "bogus" },
          worse: "nope",
        },
      },
    });
    expect(cp).not.toBeNull();
    expect(Object.keys(cp!.scenes)).toEqual(["good"]);
  });
});

describe("skip logic", () => {
  it("returns the first scene that is not done", () => {
    let cp = checkpointFor(null);
    cp = checkpointFor(markSceneComplete(cp, "scene-1", {}));
    cp = checkpointFor(markSceneComplete(cp, "scene-2", {}));
    expect(firstIncompleteSceneId(IDS, cp)).toBe("scene-3");
  });

  it("returns null when every scene is done (nothing to resume)", () => {
    let cp: Json | null = null;
    for (const id of IDS) cp = checkpointFor(markSceneComplete(cp, id, {}));
    expect(firstIncompleteSceneId(IDS, cp)).toBeNull();
  });

  it("does not skip failed or invalidated scenes", () => {
    let cp = checkpointFor(null);
    cp = checkpointFor(markSceneComplete(cp, "scene-1", {}));
    cp = checkpointFor(markSceneFailed(cp, "scene-2", "boom"));
    expect(firstIncompleteSceneId(IDS, cp)).toBe("scene-2");
  });
});

describe("repair invalidation", () => {
  it("invalidates only the repaired scene; siblings stay done", () => {
    let cp: Json | null = null;
    for (const id of IDS) cp = checkpointFor(markSceneComplete(cp, id, { durationSec: 3 }));
    const invalidated = invalidateSceneCheckpoint(cp, "scene-2", "visual: bad frame");
    const next = checkpointFor(invalidated);

    expect(firstIncompleteSceneId(IDS, next)).toBe("scene-2");
    expect(sceneCheckpointState(next, "scene-1").state).toBe("done");
    expect(sceneCheckpointState(next, "scene-2").state).toBe("invalidated");
    expect(sceneCheckpointState(next, "scene-3").state).toBe("done");
  });
});

describe("summarizeCheckpoint", () => {
  it("counts per state, unknown scenes are pending", () => {
    let cp = checkpointFor(null);
    cp = checkpointFor(markSceneComplete(cp, "scene-1", {}));
    cp = checkpointFor(markSceneFailed(cp, "scene-2", "boom"));
    const summary = summarizeCheckpoint(IDS, cp);
    expect(summary).toEqual({ total: 3, done: 1, failed: 1, invalidated: 0, pending: 1 });
  });
});
