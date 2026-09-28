/**
 * Phase 4 Stream D — test helper: a chainable mock Supabase admin client.
 *
 * Records every operation as { table, op, payload } so tests can assert
 * consume-only contracts (no writes to other streams' tables) and
 * idempotency. Responders keyed by table name decide what SELECTs return.
 *
 * NOTE: dynamic chainable mocks require `any` by design; this helper is
 * test-only and never ships in production code paths.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from "vitest";

export type MockOp = "select" | "insert" | "update" | "upsert" | "delete";

export interface RecordedOp {
  table: string;
  op: MockOp;
  payload?: unknown;
  /** Extra options (e.g. upsert onConflict). */
  options?: unknown;
}

export type TableResponder = (op: MockOp, payload?: unknown) => unknown;

export function createMockAdmin(responders: Record<string, TableResponder> = {}) {
  const ops: RecordedOp[] = [];
  const lastWrite: Record<string, unknown> = {};

  const buildChain = (tableName: string): any => {
    const resolveSelect = () => {
      const fn = responders[tableName];
      return { data: fn ? fn("select", lastWrite[tableName]) : null, error: null };
    };
    const chain: any = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      in: vi.fn(() => chain),
      gte: vi.fn(() => chain),
      lte: vi.fn(() => chain),
      not: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      is: vi.fn(() => chain),
      single: vi.fn(async () => {
        ops.push({ table: tableName, op: "select" });
        return resolveSelect();
      }),
      maybeSingle: vi.fn(async () => {
        ops.push({ table: tableName, op: "select" });
        return resolveSelect();
      }),
      insert: vi.fn((payload: unknown) => {
        ops.push({ table: tableName, op: "insert", payload });
        lastWrite[tableName] = payload;
        return chain;
      }),
      update: vi.fn((payload: unknown) => {
        ops.push({ table: tableName, op: "update", payload });
        lastWrite[tableName] = payload;
        return chain;
      }),
      upsert: vi.fn((payload: unknown, opts?: unknown) => {
        ops.push({ table: tableName, op: "upsert", payload, options: opts });
        lastWrite[tableName] = payload;
        return chain;
      }),
      delete: vi.fn(() => {
        ops.push({ table: tableName, op: "delete" });
        return chain;
      }),
      // `await chain` — the query itself is a read.
      then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => {
        ops.push({ table: tableName, op: "select" });
        return Promise.resolve(resolveSelect()).then(onFulfilled, onRejected);
      },
    };
    return chain;
  };

  const admin = {
    from: vi.fn((tableName: string) => buildChain(tableName)),
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({ data: { user: null }, error: null })),
      },
    },
  };

  return { admin, ops };
}

/** Assert the consume-only contract: no writes outside the notifications table. */
export function expectConsumeOnly(ops: RecordedOp[]): void {
  const writes = ops.filter(
    (o) => o.op !== "select" && !(o.table === "notifications" && o.op === "insert"),
  );
  if (writes.length > 0) {
    throw new Error(
      `Consume-only violation: writes outside notifications: ${JSON.stringify(writes.map((w) => `${w.op}:${w.table}`))}`,
    );
  }
}
