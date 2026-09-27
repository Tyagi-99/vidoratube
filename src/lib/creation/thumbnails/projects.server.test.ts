/**
 * F15 — integration tests for thumbnail project server logic.
 *
 * Supabase is a fake in-memory client (no network, no DB); the paid path is
 * exercised with injected preflight/image/storage fakes so every gate branch
 * is verified deterministically.
 */
import { describe, expect, it, beforeEach } from "vitest";
import type { PreflightResult } from "@/lib/credits/preflight.server";
import type { ProviderResult } from "@/lib/providers/contracts";
import type { StoragePort } from "../storage";
import {
  createThumbnailProject,
  generateThumbnailVariants,
  getThumbnailProject,
  imageProviderStatus,
  linkVariantToExperiment,
  listProjectVariants,
  selectVariantWinner,
  setThumbnailProjectStatus,
  updateThumbnailCanvas,
  type AdminDb,
} from "./projects.server";
import { emptyCanvas } from "./canvas";

/* ------------------------------------------------------------------ */
/* Fake Supabase client                                                */
/* ------------------------------------------------------------------ */

type Filter = { col: string; val: unknown };
type DbOut = { data: unknown; error: { message: string } | null };
type Responder = (ctx: {
  table: string;
  op: string;
  filters: Filter[];
  payload: unknown;
}) => DbOut;

class FakeQuery {
  filters: Filter[] = [];
  op = "select";
  payload: unknown = undefined;
  constructor(
    private readonly table: string,
    private readonly respond: Responder,
  ) {}
  select(): this {
    return this;
  }
  insert(v: unknown): this {
    this.op = "insert";
    this.payload = v;
    return this;
  }
  upsert(v: unknown): this {
    this.op = "upsert";
    this.payload = v;
    return this;
  }
  update(v: unknown): this {
    this.op = "update";
    this.payload = v;
    return this;
  }
  eq(col: string, val: unknown): this {
    this.filters.push({ col, val });
    return this;
  }
  order(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  private exec(): DbOut {
    return this.respond({
      table: this.table,
      op: this.op,
      filters: this.filters,
      payload: this.payload,
    });
  }
  async maybeSingle(): Promise<DbOut> {
    return this.exec();
  }
  async single(): Promise<DbOut> {
    return this.exec();
  }
  then(onF: (v: DbOut) => void, onR?: (e: unknown) => void): Promise<void> {
    return Promise.resolve(this.exec()).then(onF, onR);
  }
}

class FakeDb {
  calls: { table: string; op: string; filters: Filter[]; payload: unknown }[] = [];
  constructor(private readonly respond: Responder) {}
  from(table: string): FakeQuery {
    return new FakeQuery(table, (ctx) => {
      this.calls.push(ctx);
      return this.respond(ctx);
    });
  }
  asAdmin(): AdminDb {
    return this as unknown as AdminDb;
  }
}

const ok = (data: unknown): DbOut => ({ data, error: null });
const dbErr = (message: string): DbOut => ({ data: null, error: { message } });

/* ------------------------------------------------------------------ */
/* Fake paid-path deps                                                 */
/* ------------------------------------------------------------------ */

function makeStorage(): StoragePort & { uploaded: { path: string; contentType: string }[] } {
  const uploaded: { path: string; contentType: string }[] = [];
  return {
    uploaded,
    uploadImage: async (path: string, _bytes: Uint8Array, contentType: string) => {
      uploaded.push({ path, contentType });
    },
    signImage: async (path: string) => `signed:${path}`,
  };
}

function preflightOk(): PreflightResult {
  return {
    ok: true,
    estimate: { isEstimate: true, type: "ESTIMATE", credits: 2, breakdown: { lines: [] } },
    balance: 100,
    warnings: [],
  } as unknown as PreflightResult;
}

function preflightDenied(): PreflightResult {
  return {
    ok: false,
    code: "INSUFFICIENT_CREDITS",
    message: "Insufficient credits",
    estimate: { isEstimate: true, type: "ESTIMATE", credits: 2, breakdown: { lines: [] } },
  } as unknown as PreflightResult;
}

function imageOk(bytes = new Uint8Array([1, 2, 3])): ProviderResult<Uint8Array> {
  return {
    ok: true,
    output: bytes,
    model: "google/gemini-2.5-flash-image",
    taskId: null,
    latencyMs: 10,
    estimatedCost: null,
    actualCost: null,
    costCurrency: "credits",
    status: "ok",
    error: null,
    usage: { images: 1 },
  };
}

const UID = "11111111-1111-4111-8111-111111111111";
const PID = "22222222-2222-4222-8222-222222222222";

let projectsRow: { id: string } | null;
let thumbProjectRow: Record<string, unknown> | null;

function projectResponder(extra?: Responder): Responder {
  return (ctx) => {
    if (ctx.table === "projects" && ctx.op === "select") return ok(projectsRow);
    if (ctx.table === "thumbnail_projects" && ctx.op === "insert") {
      thumbProjectRow = { id: "tp-1", ...(ctx.payload as object) };
      return ok(thumbProjectRow);
    }
    if (ctx.table === "thumbnail_projects" && ctx.op === "select") return ok(thumbProjectRow);
    if (ctx.table === "thumbnail_projects" && ctx.op === "update") {
      if (!thumbProjectRow) return ok(null);
      thumbProjectRow = { ...thumbProjectRow, ...(ctx.payload as object) };
      return ok(thumbProjectRow);
    }
    return extra ? extra(ctx) : dbErr(`unexpected ${ctx.table}.${ctx.op}`);
  };
}

beforeEach(() => {
  projectsRow = { id: PID };
  thumbProjectRow = null;
});

/* ------------------------------------------------------------------ */
/* Project CRUD + canvas                                               */
/* ------------------------------------------------------------------ */

describe("createThumbnailProject", () => {
  it("creates a draft project with an empty 16:9 canvas", async () => {
    const db = new FakeDb(projectResponder());
    const res = await createThumbnailProject(db.asAdmin(), {
      userId: UID,
      projectId: PID,
      name: "Launch set",
      aspect: "16:9",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.status).toBe("draft");
      expect(res.data.width).toBe(1280);
      expect(res.data.height).toBe(720);
      expect(res.data.name).toBe("Launch set");
      expect((res.data.canvas as { layers: unknown[] }).layers).toEqual([]);
    }
  });

  it("rejects when the project does not belong to the user", async () => {
    projectsRow = null;
    const db = new FakeDb(projectResponder());
    const res = await createThumbnailProject(db.asAdmin(), { userId: UID, projectId: PID });
    expect(res).toMatchObject({ ok: false, code: "project_not_found" });
  });
});

describe("getThumbnailProject", () => {
  it("returns the canvas with zero problems when valid", async () => {
    thumbProjectRow = {
      id: "tp-1",
      user_id: UID,
      project_id: PID,
      name: "Set",
      canvas: emptyCanvas(),
      width: 1280,
      height: 720,
      status: "draft",
      created_at: "",
      updated_at: "",
    };
    const db = new FakeDb(projectResponder());
    const res = await getThumbnailProject(db.asAdmin(), { userId: UID, projectId: PID });
    expect(res.ok).toBe(true);
    if (res.ok && res.data) {
      expect(res.data.problems).toEqual([]);
      expect(res.data.canvas.layers).toEqual([]);
    }
  });

  it("falls back to an empty canvas and reports problems on corrupt state", async () => {
    thumbProjectRow = {
      id: "tp-1",
      user_id: UID,
      project_id: PID,
      name: "Set",
      canvas: { layers: "corrupt" },
      width: 1280,
      height: 720,
      status: "draft",
      created_at: "",
      updated_at: "",
    };
    const db = new FakeDb(projectResponder());
    const res = await getThumbnailProject(db.asAdmin(), { userId: UID, projectId: PID });
    expect(res.ok).toBe(true);
    if (res.ok && res.data) {
      expect(res.data.problems.length).toBeGreaterThan(0);
      expect(res.data.canvas.layers).toEqual([]);
    }
  });
});

describe("updateThumbnailCanvas", () => {
  it("rejects invalid canvas states without touching the DB", async () => {
    const db = new FakeDb(projectResponder());
    const res = await updateThumbnailCanvas(db.asAdmin(), {
      userId: UID,
      thumbnailProjectId: "tp-1",
      canvas: { layers: [{ id: "x" }] },
    });
    expect(res).toMatchObject({ ok: false, code: "invalid_canvas" });
    expect(db.calls.filter((c) => c.op === "update")).toHaveLength(0);
  });
});

describe("setThumbnailProjectStatus", () => {
  it("allows draft → in_review → approved", async () => {
    thumbProjectRow = { id: "tp-1", status: "draft" };
    const db = new FakeDb(projectResponder());
    const r1 = await setThumbnailProjectStatus(db.asAdmin(), {
      userId: UID,
      thumbnailProjectId: "tp-1",
      status: "in_review",
    });
    expect(r1.ok).toBe(true);
    const r2 = await setThumbnailProjectStatus(db.asAdmin(), {
      userId: UID,
      thumbnailProjectId: "tp-1",
      status: "approved",
    });
    expect(r2.ok).toBe(true);
  });

  it("rejects illegal jumps and terminal-approved moves", async () => {
    thumbProjectRow = { id: "tp-1", status: "draft" };
    const db = new FakeDb(projectResponder());
    const bad = await setThumbnailProjectStatus(db.asAdmin(), {
      userId: UID,
      thumbnailProjectId: "tp-1",
      status: "approved",
    });
    expect(bad).toMatchObject({ ok: false, code: "illegal_transition" });
    thumbProjectRow = { id: "tp-1", status: "approved" };
    const terminal = await setThumbnailProjectStatus(db.asAdmin(), {
      userId: UID,
      thumbnailProjectId: "tp-1",
      status: "draft",
    });
    expect(terminal).toMatchObject({ ok: false, code: "illegal_transition" });
  });
});

/* ------------------------------------------------------------------ */
/* Paid variant generation                                             */
/* ------------------------------------------------------------------ */

describe("generateThumbnailVariants", () => {
  const baseInput = {
    userId: UID,
    projectId: PID,
    videoTitle: "Why the sky is blue",
    videoTopic: "atmospheric science",
  };

  it("returns image_provider_unconfigured and never calls the provider without keys", async () => {
    let called = 0;
    const db = new FakeDb(projectResponder());
    const res = await generateThumbnailVariants(db.asAdmin(), makeStorage(), baseInput, {
      providerConfigured: () => false,
      generateImage: async () => {
        called++;
        return imageOk();
      },
    });
    expect(res).toMatchObject({ ok: false, code: "image_provider_unconfigured" });
    expect(called).toBe(0);
    expect(db.calls.filter((c) => c.table === "thumbnails")).toHaveLength(0);
  });

  it("refuses before generation when preflight denies", async () => {
    let called = 0;
    const db = new FakeDb(projectResponder());
    const res = await generateThumbnailVariants(db.asAdmin(), makeStorage(), baseInput, {
      providerConfigured: () => true,
      checkPreflight: async () => preflightDenied(),
      generateImage: async () => {
        called++;
        return imageOk();
      },
    });
    expect(res).toMatchObject({ ok: false, code: "INSUFFICIENT_CREDITS" });
    expect(called).toBe(0);
  });

  it("generates, uploads and records N variants after a passing preflight", async () => {
    let upsertCount = 0;
    const db = new FakeDb(
      projectResponder((ctx) => {
        if (ctx.table === "thumbnails" && ctx.op === "upsert") {
          upsertCount++;
          return ok({ id: `thumb-${upsertCount}` });
        }
        return dbErr(`unexpected ${ctx.table}.${ctx.op}`);
      }),
    );
    const storage = makeStorage();
    const res = await generateThumbnailVariants(
      db.asAdmin(),
      storage,
      { ...baseInput, count: 2, aspect: "9:16" },
      {
        providerConfigured: () => true,
        checkPreflight: async () => preflightOk(),
        generateImage: async () => imageOk(),
      },
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toHaveLength(2);
      expect(res.data[0]!.aspect).toBe("9:16");
    }
    expect(storage.uploaded).toHaveLength(2);
    expect(storage.uploaded[0]!.path).toContain("thumbnails/proj-v1-9x16.jpg");
    expect(upsertCount).toBe(2);
    const payloads = db.calls
      .filter((c) => c.table === "thumbnails" && c.op === "upsert")
      .map((c) => c.payload as Record<string, unknown>);
    expect(payloads[0]).toMatchObject({
      user_id: UID,
      project_id: PID,
      variant: 1,
      aspect: "9:16",
      is_ai_generated: true,
      provider: "lovable-ai",
    });
    expect(payloads[0]!["prompt_hash"]).toBeTruthy();
  });

  it("surfaces provider errors without partial fabrication", async () => {
    const db = new FakeDb(projectResponder());
    const res = await generateThumbnailVariants(db.asAdmin(), makeStorage(), baseInput, {
      providerConfigured: () => true,
      checkPreflight: async () => preflightOk(),
      generateImage: async () => ({
        ...imageOk(),
        ok: false as const,
        output: null,
        status: "error" as const,
        error: { code: "gateway_500", message: "Gateway exploded" },
      }),
    });
    expect(res).toMatchObject({ ok: false, code: "provider_error" });
  });
});

/* ------------------------------------------------------------------ */
/* Variant management                                                  */
/* ------------------------------------------------------------------ */

describe("listProjectVariants", () => {
  it("returns rows with signed view URLs", async () => {
    const rows = [
      { id: "t1", url: "u/1.jpg", final_url: null },
      { id: "t2", url: "u/2.jpg", final_url: "u/2-final.jpg" },
    ];
    const db = new FakeDb((ctx) =>
      ctx.table === "thumbnails" && ctx.op === "select" ? ok(rows) : dbErr("unexpected"),
    );
    const res = await listProjectVariants(db.asAdmin(), makeStorage(), {
      userId: UID,
      projectId: PID,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toHaveLength(2);
      expect(res.data[0]!.viewUrl).toBe("signed:u/1.jpg");
      expect(res.data[1]!.viewUrl).toBe("signed:u/2-final.jpg");
    }
  });
});

describe("selectVariantWinner", () => {
  it("clears sibling selections then marks the winner", async () => {
    const updates: unknown[] = [];
    const db = new FakeDb((ctx) => {
      if (ctx.table === "thumbnails" && ctx.op === "select")
        return ok({ id: "t-winner", project_id: PID, aspect: "16:9" });
      if (ctx.table === "thumbnails" && ctx.op === "update") {
        updates.push({ payload: ctx.payload, filters: ctx.filters });
        if (ctx.filters.some((f) => f.col === "id")) return ok({ id: "t-winner", selected: true });
        return ok([]);
      }
      return dbErr("unexpected");
    });
    const res = await selectVariantWinner(db.asAdmin(), { userId: UID, thumbnailId: "t-winner" });
    expect(res.ok).toBe(true);
    expect(updates).toHaveLength(2);
    expect((updates[0] as { payload: unknown }).payload).toEqual({ selected: false });
    expect((updates[1] as { payload: unknown }).payload).toEqual({ selected: true });
  });

  it("returns not_found for another user's thumbnail", async () => {
    const db = new FakeDb((ctx) =>
      ctx.table === "thumbnails" && ctx.op === "select" ? ok(null) : dbErr("unexpected"),
    );
    const res = await selectVariantWinner(db.asAdmin(), { userId: UID, thumbnailId: "nope" });
    expect(res).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("linkVariantToExperiment", () => {
  it("records the arm linkage (status flow only)", async () => {
    const db = new FakeDb((ctx) => {
      if (ctx.table === "experiments" && ctx.op === "select") return ok({ id: "exp-1" });
      if (ctx.table === "thumbnails" && ctx.op === "select") return ok({ id: "t-1" });
      if (ctx.table === "experiment_arms" && ctx.op === "insert") {
        return ok({ id: "arm-1", ...(ctx.payload as object), created_at: "" });
      }
      return dbErr("unexpected");
    });
    const res = await linkVariantToExperiment(db.asAdmin(), {
      userId: UID,
      experimentId: "exp-1",
      thumbnailId: "t-1",
      armName: "Bold v2",
      armType: "variant",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.arm_type).toBe("variant");
      expect(res.data.thumbnail_id).toBe("t-1");
    }
  });

  it("rejects unknown experiments", async () => {
    const db = new FakeDb((ctx) =>
      ctx.table === "experiments" && ctx.op === "select" ? ok(null) : dbErr("unexpected"),
    );
    const res = await linkVariantToExperiment(db.asAdmin(), {
      userId: UID,
      experimentId: "nope",
      thumbnailId: "t-1",
    });
    expect(res).toMatchObject({ ok: false, code: "experiment_not_found" });
  });
});

describe("imageProviderStatus", () => {
  it("reports the honest provider state without network", () => {
    const status = imageProviderStatus();
    expect(typeof status.configured).toBe("boolean");
    expect(status.label.length).toBeGreaterThan(0);
  });
});
