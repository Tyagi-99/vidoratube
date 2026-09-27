/**
 * Stream B — getProjectStrictGate unit tests.
 * The shared fail-closed gate (publish approval, publish execution, UI
 * banner) against a minimal fake supabase chain. No network, no DB.
 */
import { describe, expect, it } from "vitest";
import { getProjectStrictGate, type GateDb } from "./strict-gate";

type GateState = {
  project?: { id: string; research_strict_mode: boolean } | null;
  projectError?: string;
  sourceIds?: string[];
  total?: number;
  unconfirmed?: number;
};

type FakeGateQuery = {
  select: () => FakeGateQuery;
  eq: () => FakeGateQuery;
  in: () => FakeGateQuery;
  neq: () => FakeGateQuery;
  maybeSingle: () => Promise<{
    data: { id: string; research_strict_mode: boolean } | null;
    error: { message: string } | null;
  }>;
  then: (
    onfulfilled: (value: {
      data: { id: string }[] | null;
      error: { message: string } | null;
      count: number | null;
    }) => void,
  ) => void;
};

/**
 * Thenable fake of the supabase query surface strict-gate.ts uses.
 * A hand-built chain can never satisfy the real PostgrestQueryBuilder
 * type, so the fake is cast once here (test double, no production
 * code is affected).
 */
function fakeSupabase(state: GateState): GateDb {
  const from = (table: string): FakeGateQuery => {
    const calls: string[] = [];
    const chain: FakeGateQuery = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      neq: () => {
        calls.push("neq");
        return chain;
      },
      maybeSingle: async () => {
        if (table !== "projects") throw new Error(`unexpected maybeSingle on ${table}`);
        return {
          data: state.project ?? null,
          error: state.projectError ? { message: state.projectError } : null,
        };
      },
      then: (onfulfilled) => {
        if (table === "research_sources") {
          onfulfilled({
            data: (state.sourceIds ?? []).map((id) => ({ id })),
            error: null,
            count: null,
          });
          return;
        }
        if (table === "research_claims") {
          onfulfilled({
            data: null,
            error: null,
            count: (calls.includes("neq") ? state.unconfirmed : state.total) ?? 0,
          });
          return;
        }
        onfulfilled({ data: null, error: { message: `unexpected table ${table}` }, count: null });
      },
    };
    return chain;
  };
  return { from } as unknown as GateDb;
}

const UID = "user-1";
const PID = "proj-1";

describe("getProjectStrictGate", () => {
  it("is advisory when strict mode is off", async () => {
    const g = await getProjectStrictGate(
      fakeSupabase({ project: { id: PID, research_strict_mode: false } }),
      UID,
      PID,
    );
    expect(g.strictMode).toBe(false);
    expect(g.blocked).toBe(false);
  });

  it("blocks when any claim is not confirmed (fail-closed, D99)", async () => {
    const g = await getProjectStrictGate(
      fakeSupabase({
        project: { id: PID, research_strict_mode: true },
        sourceIds: ["s1"],
        total: 3,
        unconfirmed: 1,
      }),
      UID,
      PID,
    );
    expect(g.strictMode).toBe(true);
    expect(g.blocked).toBe(true);
    expect(g.unconfirmedCount).toBe(1);
    expect(g.totalClaims).toBe(3);
    expect(g.message).toMatch(/Evidence desk/);
  });

  it("allows publishing when every claim is confirmed", async () => {
    const g = await getProjectStrictGate(
      fakeSupabase({
        project: { id: PID, research_strict_mode: true },
        sourceIds: ["s1"],
        total: 2,
        unconfirmed: 0,
      }),
      UID,
      PID,
    );
    expect(g.blocked).toBe(false);
    expect(g.message).toMatch(/all 2 claims confirmed/);
  });

  it("allows publishing when strict mode is on but there are no claims", async () => {
    const g = await getProjectStrictGate(
      fakeSupabase({ project: { id: PID, research_strict_mode: true }, sourceIds: [] }),
      UID,
      PID,
    );
    expect(g.blocked).toBe(false);
    expect(g.message).toMatch(/no claims to review/);
  });

  it("throws when the project is not found (fail-closed)", async () => {
    await expect(getProjectStrictGate(fakeSupabase({ project: null }), UID, PID)).rejects.toThrow(
      /Project not found/,
    );
  });

  it("throws on query errors (fail-closed: a failed read blocks)", async () => {
    await expect(
      getProjectStrictGate(fakeSupabase({ projectError: "db exploded" }), UID, PID),
    ).rejects.toThrow(/Strict gate check failed/);
  });
});
