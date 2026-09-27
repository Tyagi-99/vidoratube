/**
 * F20 Video Studio — per-scene regen core tests.
 *
 * The provider and preflight modules are mocked; the Supabase client is a
 * small scripted fake (no network). Verifies the paid-op discipline:
 * preflight before debit, debit before provider, refund on provider failure,
 * one scene_versions row per regen, no whole-video re-render.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  regenerateSceneAudioCore,
  regenerateSceneVisualCore,
  recomputeSceneTimingCore,
  SCENE_ASSET_BUCKET,
} from "./regen.server";

vi.mock("../../credits/preflight.server", () => ({
  preflightCreditsCheck: vi.fn(),
}));
vi.mock("../../providers/voice.server", () => ({
  synthesizeWithTelemetry: vi.fn(),
  mp3Duration: vi.fn(),
  DEFAULT_VOICE_ID: "default-voice",
  DEFAULT_VOICE_MODEL: "eleven_flash_v2_5",
}));
vi.mock("../../providers/image.server", () => ({
  generateImageWithTelemetry: vi.fn(),
}));

import { preflightCreditsCheck } from "../../credits/preflight.server";
import { synthesizeWithTelemetry, mp3Duration } from "../../providers/voice.server";
import { generateImageWithTelemetry } from "../../providers/image.server";
import type { ProviderResult } from "../../providers/contracts";

/* ── Scripted Supabase fake ─────────────────────────────────────────── */

type Row = Record<string, unknown>;

class FakeSelect {
  constructor(
    private table: Row[],
    private filters: ((r: Row) => boolean)[] = [],
    private sort: { key: string; ascending: boolean } | null = null,
    private take: number | null = null,
  ) {}
  eq(key: string, value: unknown): FakeSelect {
    return new FakeSelect(
      this.table,
      [...this.filters, (r) => r[key] === value],
      this.sort,
      this.take,
    );
  }
  in(key: string, values: unknown[]): FakeSelect {
    return new FakeSelect(
      this.table,
      [...this.filters, (r) => values.includes(r[key])],
      this.sort,
      this.take,
    );
  }
  order(key: string, opts: { ascending: boolean }): FakeSelect {
    return new FakeSelect(this.table, this.filters, { key, ascending: opts.ascending }, this.take);
  }
  limit(n: number): FakeSelect {
    return new FakeSelect(this.table, this.filters, this.sort, n);
  }
  private run(): Row[] {
    let rows = this.table.filter((r) => this.filters.every((f) => f(r)));
    if (this.sort) {
      const { key, ascending } = this.sort;
      rows = [...rows].sort((a, b) =>
        ascending ? Number(a[key]) - Number(b[key]) : Number(b[key]) - Number(a[key]),
      );
    }
    if (this.take != null) rows = rows.slice(0, this.take);
    return rows;
  }
  async maybeSingle(): Promise<{ data: Row | null; error: null }> {
    return { data: this.run()[0] ?? null, error: null };
  }
  async single(): Promise<{ data: Row; error: null }> {
    const row = this.run()[0];
    if (!row) throw new Error("no rows");
    return { data: row, error: null };
  }
}

function makeFakeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const uploads: { bucket: string; path: string }[] = [];

  const from = (table: string) => ({
    select: (_cols: string) => new FakeSelect(tables[table] ?? []),
    insert: async (row: Row) => {
      (tables[table] ??= []).push({ id: `id-${tables[table]!.length}`, ...row });
      return { data: null, error: null };
    },
    update: (patch: Row) => ({
      eq: async (key: string, value: unknown) => {
        for (const r of tables[table] ?? []) {
          if (r[key] === value) Object.assign(r, patch);
        }
        return { data: null, error: null };
      },
    }),
    delete: () => ({
      eq: async (key: string, value: unknown) => {
        tables[table] = (tables[table] ?? []).filter((r) => r[key] !== value);
        return { data: null, error: null };
      },
    }),
  });

  const storage = {
    from: (bucket: string) => ({
      upload: async (path: string) => {
        uploads.push({ bucket, path });
        return { data: { path }, error: null };
      },
      createSignedUrl: async (path: string) => ({
        data: { signedUrl: `https://signed.example/${bucket}/${path}` },
        error: null,
      }),
    }),
  };

  const rpc = async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    return { data: 1, error: null };
  };

  return {
    admin: { from, storage, rpc } as never,
    tables,
    rpcCalls,
    uploads,
    rpcNamed: (name: string) => rpcCalls.filter((c) => c.name === name),
  };
}

/** Bracket access: the repo forbids dot access on index signatures. */
function rows(db: { tables: Record<string, Row[]> }, table: string): Row[] {
  return db.tables[table] ?? [];
}
/** Cell value: bracket access only (repo forbids dot access on index signatures). */
function val(
  db: { tables: Record<string, Row[]> },
  table: string,
  index: number,
  key: string,
): unknown {
  return rows(db, table)[index]?.[key];
}

const USER = "user-1";
const SCENE = "scene-1";
const PROJECT = "project-1";

function seedDb() {
  return makeFakeDb({
    scenes: [
      {
        id: SCENE,
        project_id: PROJECT,
        user_id: USER,
        scene_number: 2,
        narration: "The valley wakes under a pale gold sky.",
        visual_prompt: "Valley at dawn, painterly",
        asset_url: "https://example.com/old.png",
      },
    ],
    projects: [{ id: PROJECT, aspect_ratio: "16:9" }],
    voiceovers: [],
    scene_versions: [],
  });
}

function okPreflight(credits = 3) {
  vi.mocked(preflightCreditsCheck).mockResolvedValue({
    ok: true,
    estimate: { credits, isEstimate: true, type: "estimate", breakdown: { lines: [] } },
    balance: 100,
    warnings: [],
  } as never);
}

function okTts() {
  vi.mocked(synthesizeWithTelemetry).mockResolvedValue({
    ok: true,
    output: new ArrayBuffer(16),
    model: "eleven_flash_v2_5",
    taskId: "task-1",
    latencyMs: 120,
    estimatedCost: 3,
    actualCost: 3,
    costCurrency: "credits",
    status: "ok",
    error: null,
    usage: { characters: 42 },
  });
  vi.mocked(mp3Duration).mockReturnValue(4.5);
}

function okImage() {
  vi.mocked(generateImageWithTelemetry).mockResolvedValue({
    ok: true,
    output: new Uint8Array([1, 2, 3]),
    model: "google/gemini-2.5-flash-image",
    taskId: "img-1",
    latencyMs: 2000,
    estimatedCost: 1,
    actualCost: 1,
    costCurrency: "credits",
    status: "ok",
    error: null,
    usage: { images: 1 },
  });
}

function failedResult(code: string, message: string): ProviderResult<never> {
  return {
    ok: false,
    output: null,
    model: null,
    taskId: null,
    latencyMs: 10,
    estimatedCost: null,
    actualCost: null,
    costCurrency: "credits",
    status: "error",
    error: { code, message },
    usage: {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

/* ── Audio regen ────────────────────────────────────────────────────── */

describe("regenerateSceneAudioCore", () => {
  it("debits before the provider call, uploads, updates voiceovers, writes one scene_versions row", async () => {
    okPreflight(3);
    okTts();
    const db = seedDb();

    const result = await regenerateSceneAudioCore(db.admin, USER, SCENE);

    expect(result.ok).toBe(true);
    expect(result.output?.audioUrl).toContain("scene-assets");
    expect(result.output?.durationSec).toBe(4.5);
    expect(result.output?.durationEstimated).toBe(false);

    // Paid-op discipline: preflight → debit → provider; exactly one debit.
    expect(preflightCreditsCheck).toHaveBeenCalledTimes(1);
    const debits = db.rpcNamed("debit_credits_amount_once");
    expect(debits).toHaveLength(1);
    expect(debits[0]!.args["p_amount"]).toBe(3);
    expect(debits[0]!.args["p_user_id"]).toBe(USER);
    expect(synthesizeWithTelemetry).toHaveBeenCalledTimes(1);
    expect(db.rpcNamed("grant_credits_once")).toHaveLength(0);

    // One live voiceovers row + one version row; the scene row itself is untouched.
    expect(rows(db, "voiceovers")).toHaveLength(1);
    expect(val(db, "voiceovers", 0, "scene_id")).toBe(SCENE);
    expect(rows(db, "scene_versions")).toHaveLength(1);
    expect(val(db, "scene_versions", 0, "version_number")).toBe(1);
    expect(val(db, "scene_versions", 0, "change_note")).toContain("narration audio regenerated");
    expect(val(db, "scenes", 0, "asset_url")).toBe("https://example.com/old.png");
  });

  it("refunds the debit when the TTS provider fails and writes nothing", async () => {
    okPreflight(3);
    vi.mocked(synthesizeWithTelemetry).mockResolvedValue(failedResult("tts_failed", "boom"));
    const db = seedDb();

    const result = await regenerateSceneAudioCore(db.admin, USER, SCENE);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("tts_failed");
    expect(db.rpcNamed("debit_credits_amount_once")).toHaveLength(1);
    const refunds = db.rpcNamed("grant_credits_once");
    expect(refunds).toHaveLength(1);
    expect(refunds[0]!.args["p_amount"]).toBe(3);
    expect(rows(db, "scene_versions")).toHaveLength(0);
    expect(rows(db, "voiceovers")).toHaveLength(0);
  });

  it("never reaches the provider when preflight denies (insufficient credits)", async () => {
    vi.mocked(preflightCreditsCheck).mockResolvedValue({
      ok: false,
      code: "INSUFFICIENT_CREDITS",
      message: "Insufficient credits",
      estimate: { credits: 3 },
    } as never);
    const db = seedDb();

    const result = await regenerateSceneAudioCore(db.admin, USER, SCENE);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INSUFFICIENT_CREDITS");
    expect(db.rpcNamed("debit_credits_amount_once")).toHaveLength(0);
    expect(synthesizeWithTelemetry).not.toHaveBeenCalled();
  });

  it("rejects a scene owned by someone else without spending", async () => {
    okPreflight(3);
    const db = seedDb();
    const result = await regenerateSceneAudioCore(db.admin, "other-user", SCENE);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("scene_not_found");
    expect(db.rpcNamed("debit_credits_amount_once")).toHaveLength(0);
  });

  it("uses the words-per-minute ESTIMATE when the MP3 duration is unparseable", async () => {
    okPreflight(3);
    okTts();
    vi.mocked(mp3Duration).mockReturnValue(0);
    const db = seedDb();

    const result = await regenerateSceneAudioCore(db.admin, USER, SCENE);

    expect(result.ok).toBe(true);
    expect(result.output?.durationEstimated).toBe(true);
    expect(result.output?.durationSec).toBeGreaterThan(0);
  });
});

/* ── Visual regen ───────────────────────────────────────────────────── */

describe("regenerateSceneVisualCore", () => {
  it("regenerates the visual, updates the live scene row, writes one version row", async () => {
    okPreflight(1);
    okImage();
    const db = seedDb();

    const result = await regenerateSceneVisualCore(db.admin, USER, SCENE);

    expect(result.ok).toBe(true);
    expect(result.output?.assetUrl).toContain(SCENE_ASSET_BUCKET);
    expect(db.rpcNamed("debit_credits_amount_once")).toHaveLength(1);
    expect(generateImageWithTelemetry).toHaveBeenCalledTimes(1);
    const req = vi.mocked(generateImageWithTelemetry).mock.calls[0]![0];
    expect(req.prompt).toContain("Valley at dawn");
    expect(req.aspectRatio).toBe("16:9");

    // Live scene row updated in place (no new scene), one version row.
    expect(rows(db, "scenes")).toHaveLength(1);
    expect(val(db, "scenes", 0, "asset_url")).toContain("visual-v1");
    expect(val(db, "scenes", 0, "status")).toBe("assets_ready");
    expect(rows(db, "scene_versions")).toHaveLength(1);
    expect(val(db, "scene_versions", 0, "visual_prompt")).toContain("Valley at dawn");
  });

  it("refunds when the image provider fails", async () => {
    okPreflight(1);
    vi.mocked(generateImageWithTelemetry).mockResolvedValue(failedResult("image_failed", "boom"));
    const db = seedDb();

    const result = await regenerateSceneVisualCore(db.admin, USER, SCENE);

    expect(result.ok).toBe(false);
    expect(db.rpcNamed("grant_credits_once")).toHaveLength(1);
    expect(val(db, "scenes", 0, "asset_url")).toBe("https://example.com/old.png");
    expect(rows(db, "scene_versions")).toHaveLength(0);
  });

  it("fails free (no preflight, no debit) when there is no prompt", async () => {
    okPreflight(1);
    const db = makeFakeDb({
      scenes: [
        {
          id: SCENE,
          project_id: PROJECT,
          user_id: USER,
          scene_number: 1,
          narration: "   ",
          visual_prompt: null,
          asset_url: null,
        },
      ],
      projects: [{ id: PROJECT, aspect_ratio: "16:9" }],
      voiceovers: [],
      scene_versions: [],
    });

    const result = await regenerateSceneVisualCore(db.admin, USER, SCENE);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("empty_prompt");
    expect(preflightCreditsCheck).not.toHaveBeenCalled();
    expect(db.rpcNamed("debit_credits_amount_once")).toHaveLength(0);
  });
});

/* ── Timing repair (free) ───────────────────────────────────────────── */

describe("recomputeSceneTimingCore", () => {
  it("writes a version row without any provider or billing call", async () => {
    const db = seedDb();
    const result = await recomputeSceneTimingCore(db.admin, USER, SCENE, 6.5);
    expect(result.ok).toBe(true);
    expect(preflightCreditsCheck).not.toHaveBeenCalled();
    expect(db.rpcNamed("debit_credits_amount_once")).toHaveLength(0);
    expect(rows(db, "scene_versions")).toHaveLength(1);
    expect(val(db, "scene_versions", 0, "change_note")).toContain("6.5s");
    // Live scene row untouched — duration is an ESTIMATE consumed at assemble.
    expect(val(db, "scenes", 0, "asset_url")).toBe("https://example.com/old.png");
  });

  it("rejects non-positive durations", async () => {
    const db = seedDb();
    const result = await recomputeSceneTimingCore(db.admin, USER, SCENE, 0);
    expect(result.ok).toBe(false);
    expect(rows(db, "scene_versions")).toHaveLength(0);
  });
});
