/**
 * Chapter pipeline tests (run with: npx tsx --test src/*.test.ts).
 *
 * Covers (Sprint 3-4):
 * - planChapterWork: crash-resume planning (3 of 6 done -> only 3 render)
 * - runWithConcurrency: limit respected, all items run, errors propagate
 * - Driver resume: injected renderer + fake Supabase; only missing chapters
 *   render, every chapter receives the IDENTICAL brief object
 * - renderChapter + stitchChapters end-to-end with real ffmpeg (skipped
 *   when the binaries are missing)
 * - Static audit of the chapters migration (tables, RPC, RLS, grants)
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer, type Server } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  chapterLocalPath,
  chapterStoragePath,
  defaultContinuityBrief,
  planChapterWork,
  renderChapter,
  runChapterPipeline,
  runWithConcurrency,
  stitchChapters,
  type ChapterDriverCtx,
  type ChapterRow,
} from "./chapters.js";
import { probeDuration } from "./ffmpeg.js";
import type { WorkerConfig } from "./config.js";
import { RenderJobMetaSchema, type RenderJobMeta } from "./types.js";

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";

function hasBinary(bin: string): boolean {
  try {
    return spawnSync(bin, ["-version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}
const BINARIES_OK = hasBinary(FFMPEG) && hasBinary(FFPROBE);

function makeChapter(index: number, overrides: Partial<ChapterRow> = {}): ChapterRow {
  return {
    id: `ch-${index}`,
    render_id: "render-1",
    chapter_index: index,
    title: `Chapter ${index}`,
    script_text: `Script for chapter ${index}.`,
    paragraphs: [
      { text: `Narration one for chapter ${index}.`, audio_path: `https://x/p${index}a.mp3`, duration_seconds: 2 },
      { text: `Narration two for chapter ${index}.`, audio_path: `https://x/p${index}b.mp3`, duration_seconds: 2 },
    ],
    status: "queued",
    attempts: 0,
    max_attempts: 3,
    claimed_at: null,
    claimed_by: null,
    output_path: null,
    error: null,
    ...overrides,
  };
}

function makeCfg(workDir: string): WorkerConfig {
  return {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-key-with-enough-length",
    RENDER_BUCKET: "generated-videos",
    BRAND_LOGOS_BUCKET: "brand-logos",
    FFMPEG_PATH: FFMPEG,
    FFPROBE_PATH: FFPROBE,
    WORKER_ID: "test-worker",
    POLL_INTERVAL_SEC: 5,
    WORK_DIR: workDir,
    CONCURRENCY: 1,
    WORKER_CHAPTER_CONCURRENCY: 2,
  };
}

function makeMeta(): RenderJobMeta {
  return RenderJobMetaSchema.parse({
    scenes: [{ id: "chapter-mode", number: 0, narration: "", image: null, audio: null, duration: 120, cues: [] }],
    title: "Long video",
    aspect: "16:9",
    fps: 30,
    burnCaptions: true,
    chapterMode: true,
    continuityBrief: defaultContinuityBrief(),
  });
}

// ── Minimal fake Supabase for the driver ────────────────────────────────────

type FakeState = {
  chapters: ChapterRow[];
  /** storagePath -> bytes, for download() */
  storage: Map<string, Buffer>;
  uploaded: string[];
};

function makeFakeSupabase(state: FakeState): SupabaseClient {
  const table = () => {
    const filters: ((r: ChapterRow) => boolean)[] = [];
    const api: Record<string, unknown> = {
      select(_cols?: string) {
        return api;
      },
      eq(col: string, val: unknown) {
        filters.push((r) => (r as unknown as Record<string, unknown>)[col] === val);
        return api;
      },
      order(col: string) {
        const rows = state.chapters
          .filter((r) => filters.every((f) => f(r)))
          .sort((a, b) => (a[col as keyof ChapterRow] as number) - (b[col as keyof ChapterRow] as number));
        return Promise.resolve({ data: rows, error: null });
      },
      update(patch: Record<string, unknown>) {
        const terminal: Record<string, unknown> = {
          eq(col: string, val: unknown) {
            filters.push((r) => (r as unknown as Record<string, unknown>)[col] === val);
            return terminal;
          },
          then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
            const p = Promise.resolve().then(() => {
              for (const r of state.chapters.filter((rr) => filters.every((f) => f(rr)))) {
                Object.assign(r, patch);
              }
              return { error: null };
            });
            return p.then(onF, onR);
          },
        };
        return terminal;
      },
    };
    return api;
  };

  return {
    rpc: async (fn: string) => {
      if (fn === "requeue_stale_chapters") {
        // Mirror the SQL: stale `rendering` chapters -> queued (attempts+1),
        // budget exhausted -> failed.
        let n = 0;
        for (const c of state.chapters) {
          if (c.status !== "rendering") continue;
          const stale = !c.claimed_at || Date.now() - Date.parse(c.claimed_at) > 300_000;
          if (!stale) continue;
          c.attempts += 1;
          c.status = c.attempts >= c.max_attempts ? "failed" : "queued";
          c.claimed_at = null;
          c.claimed_by = null;
          if (c.status === "queued") n++;
        }
        return { data: n, error: null };
      }
      return { data: null, error: null };
    },
    from: (_t: string) => table(),
    storage: {
      from: (_bucket: string) => ({
        download: async (path: string) => {
          const b = state.storage.get(path);
          if (!b) return { data: null, error: { message: "not found" } };
          return { data: new Blob([new Uint8Array(b)]), error: null };
        },
        upload: async (path: string, body: Blob) => {
          state.uploaded.push(path);
          state.storage.set(path, Buffer.from(await body.arrayBuffer()));
          return { data: null, error: null };
        },
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: `https://signed.example/${path}` },
          error: null,
        }),
      }),
    },
  } as unknown as SupabaseClient;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("planChapterWork", () => {
  it("resume: 3 of 6 done -> only the remaining 3 render", () => {
    const chapters = [
      makeChapter(1, { status: "done", output_path: "a/1.mp4" }),
      makeChapter(2, { status: "done", output_path: "a/2.mp4" }),
      makeChapter(3, { status: "done", output_path: "a/3.mp4" }),
      makeChapter(4, { status: "rendering", claimed_at: new Date(Date.now() - 600_000).toISOString(), claimed_by: "dead" }),
      makeChapter(5, { status: "queued" }),
      makeChapter(6, { status: "queued" }),
    ];
    const usable = new Set(["ch-1", "ch-2", "ch-3"]);
    const plan = planChapterWork(chapters, usable);
    assert.deepEqual(plan.toReuse.map((c) => c.chapter_index), [1, 2, 3]);
    assert.deepEqual(plan.toRender.map((c) => c.chapter_index), [4, 5, 6]);
    assert.deepEqual(plan.failed, []);
  });

  it("done chapters with a missing output are re-rendered", () => {
    const chapters = [makeChapter(1, { status: "done", output_path: "a/1.mp4" })];
    const plan = planChapterWork(chapters, new Set());
    assert.equal(plan.toRender.length, 1);
    assert.equal(plan.toReuse.length, 0);
  });

  it("terminally failed chapters are reported, not rendered", () => {
    const chapters = [
      makeChapter(1, { status: "failed", error: "boom" }),
      makeChapter(2, { status: "queued" }),
    ];
    const plan = planChapterWork(chapters, new Set());
    assert.deepEqual(plan.failed.map((c) => c.chapter_index), [1]);
    assert.deepEqual(plan.toRender.map((c) => c.chapter_index), [2]);
  });
});

describe("runWithConcurrency", () => {
  it("respects the limit and runs every item", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const seen: number[] = [];
    await runWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      seen.push(n);
      inFlight--;
    });
    assert.equal(maxInFlight, 2);
    assert.deepEqual(seen.sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  });

  it("propagates the first error", async () => {
    await assert.rejects(
      runWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("item failed");
      }),
      /item failed/,
    );
  });
});

describe("chapterStoragePath / chapterLocalPath", () => {
  it("builds namespaced storage paths", () => {
    const job = { user_id: "u1", id: "r1" } as never;
    assert.equal(chapterStoragePath(job, 3), "u1/renders/r1/chapters/3.mp4");
    assert.ok(chapterLocalPath("/tmp/x", 3).endsWith("chapter-3.mp4"));
  });
});

describe("chapters migration (static audit)", () => {
  const dir = resolve(process.cwd(), "../supabase/migrations");
  const sql = readdirSync(dir)
    .filter((f) => f.includes("chapters"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");

  it("creates render_chapters and tts_cache", () => {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.render_chapters/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.tts_cache/);
  });

  it("enables RLS with owner-scoped policies on render_chapters", () => {
    assert.match(sql, /ALTER TABLE public\.render_chapters ENABLE ROW LEVEL SECURITY/);
    assert.match(sql, /Users manage chapters of their own renders/);
  });

  it("keeps tts_cache service-role only (no client policies)", () => {
    assert.match(sql, /ALTER TABLE public\.tts_cache ENABLE ROW LEVEL SECURITY/);
    assert.match(sql, /GRANT ALL ON public\.tts_cache TO service_role/);
    assert.doesNotMatch(sql, /CREATE POLICY[^;]*ON public\.tts_cache/);
  });

  it("defines requeue_stale_chapters as service-role-only SECURITY DEFINER", () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.requeue_stale_chapters/);
    assert.match(sql, /SECURITY DEFINER/);
    assert.match(
      sql,
      /REVOKE ALL ON FUNCTION public\.requeue_stale_chapters\(integer\) FROM PUBLIC, anon, authenticated/,
    );
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.requeue_stale_chapters\(integer\) TO service_role/);
  });
});

// ── Driver resume test (injected renderer, fake Supabase) ───────────────────

describe("runChapterPipeline (resume)", () => {
  it("renders only the 3 missing chapters and passes one identical brief to all", async (t) => {
    if (!BINARIES_OK) return;
    const workDir = await mkdtemp(join(tmpdir(), "vidora-chapters-test-"));
    t.after(async () => {
      await rm(workDir, { recursive: true, force: true });
    });

    // Real 1s MP4 fixtures stand in for the pre-existing chapter outputs.
    const fixture = join(workDir, "fixture.mp4");
    const fr = spawnSync(FFMPEG, [
      "-y", "-f", "lavfi", "-i", "color=c=0x17130e:s=320x240:r=30:d=1",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
      "-c:a", "aac", "-shortest", fixture,
    ]);
    assert.equal(fr.status, 0);
    const fixtureBytes = await readFile(fixture);

    // Crash simulation: chapters 1-3 done with downloadable outputs,
    // chapter 4 stuck `rendering` with an expired lease (dead worker),
    // chapters 5-6 queued.
    const old = new Date(Date.now() - 600_000).toISOString();
    const state: FakeState = {
      chapters: [
        makeChapter(1, { status: "done", output_path: "u1/renders/render-1/chapters/1.mp4" }),
        makeChapter(2, { status: "done", output_path: "u1/renders/render-1/chapters/2.mp4" }),
        makeChapter(3, { status: "done", output_path: "u1/renders/render-1/chapters/3.mp4" }),
        makeChapter(4, { status: "rendering", claimed_at: old, claimed_by: "dead-worker", attempts: 1 }),
        makeChapter(5, { status: "queued" }),
        makeChapter(6, { status: "queued" }),
      ],
      storage: new Map(),
      uploaded: [],
    };
    // Pre-existing outputs for chapters 1-3 (valid MP4 bytes).
    for (const i of [1, 2, 3]) {
      state.storage.set(`u1/renders/render-1/chapters/${i}.mp4`, fixtureBytes);
    }
    const supabase = makeFakeSupabase(state);
    const cfg = makeCfg(workDir);
    const meta = makeMeta();
    const job = { id: "render-1", user_id: "u1" } as never;

    const rendered: number[] = [];
    const briefs: unknown[] = [];
    const hooks = {
      onStage: async () => {},
      isCancelled: async () => false,
    };
    const ctx: ChapterDriverCtx = { cfg, supabase, job, meta, dir: join(workDir, "job"), hooks };

    // Injected renderer: writes a real tiny MP4 per chapter (real
    // stitching needs real MP4s).
    const finalMp4 = await runChapterPipeline(ctx, {
      renderOne: async (cctx, chapter, brief) => {
        rendered.push(chapter.chapter_index);
        briefs.push(brief);
        const dest = chapterLocalPath(cctx.cdir, chapter.chapter_index);
        const r = spawnSync(FFMPEG, [
          "-y", "-f", "lavfi", "-i", "color=c=0x17130e:s=320x240:r=30:d=1",
          "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
          "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
          "-c:a", "aac", "-shortest", dest,
        ]);
        assert.equal(r.status, 0);
        return dest;
      },
    });

    // Only chapters 4, 5, 6 were rendered.
    assert.deepEqual(rendered.sort((a, b) => a - b), [4, 5, 6]);
    // Every chapter got the IDENTICAL brief object (reference equality).
    assert.equal(briefs.length, 3);
    assert.ok(briefs.every((b) => b === briefs[0]));
    assert.ok(briefs[0] === (meta.continuityBrief as unknown));
    // All six chapters are done with storage outputs now.
    assert.ok(state.chapters.every((c) => c.status === "done"));
    assert.ok(state.chapters.every((c) => c.output_path !== null));
    // Chapter 4's stale lease was requeued first (attempts bumped by the RPC).
    assert.equal(state.chapters[3]!.attempts, 2);

    // Real stitch happened: final.mp4 ≈ 3 reused + 3 rendered 1s chapters.
    const dur = await probeDuration(FFPROBE, finalMp4);
    assert.ok(dur >= 5 && dur <= 7.5, `stitched duration ${dur}`);
  });

  it("fails the parent when a chapter exhausts its retries", async (t) => {
    const workDir = await mkdtemp(join(tmpdir(), "vidora-chapters-fail-"));
    t.after(async () => {
      await rm(workDir, { recursive: true, force: true });
    });
    const state: FakeState = {
      chapters: [makeChapter(1, { attempts: 2, max_attempts: 3 })],
      storage: new Map(),
      uploaded: [],
    };
    const supabase = makeFakeSupabase(state);
    const ctx: ChapterDriverCtx = {
      cfg: makeCfg(workDir),
      supabase,
      job: { id: "render-1", user_id: "u1" } as never,
      meta: makeMeta(),
      dir: join(workDir, "job"),
      hooks: { onStage: async () => {}, isCancelled: async () => false },
    };
    await assert.rejects(
      runChapterPipeline(ctx, {
        renderOne: async () => {
          throw new Error("ffmpeg exploded");
        },
      }),
      /Chapter 1 failed: ffmpeg exploded/,
    );
    assert.equal(state.chapters[0]!.status, "failed");
    assert.equal(state.chapters[0]!.attempts, 3);
  });
});

// ── renderChapter + stitchChapters with real ffmpeg ─────────────────────────

describe("renderChapter (ffmpeg)", () => {
  let workDir = "";
  let server: Server | null = null;
  let baseUrl = "";
  let fixtureDir = "";

  before(async () => {
    if (!BINARIES_OK) return;
    workDir = await mkdtemp(join(tmpdir(), "vidora-chapter-render-"));
    fixtureDir = join(workDir, "fixtures");
    await mkdir(fixtureDir, { recursive: true });
    // Two 2s narration fixtures (AAC in .m4a).
    for (const [name, freq] of [["p0.m4a", 440], ["p1.m4a", 550]] as const) {
      const r = spawnSync(FFMPEG, [
        "-y", "-f", "lavfi", "-i", `sine=frequency=${freq}:duration=2`,
        "-c:a", "aac", "-b:a", "128k", join(fixtureDir, name),
      ]);
      assert.equal(r.status, 0, `fixture ${name}`);
    }
    server = createServer((req, res) => {
      const name = decodeURIComponent(req.url ?? "").replace(/^\//, "");
      const file = join(fixtureDir, name);
      readFile(file).then(
        (buf) => {
          res.writeHead(200, { "Content-Type": "audio/mp4" });
          res.end(buf);
        },
        () => {
          res.writeHead(404);
          res.end();
        },
      );
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });

  after(async () => {
    server?.close();
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it("renders a chapter MP4 with narration audio and burned captions", async () => {
    if (!BINARIES_OK) return;
    const cfg = makeCfg(workDir);
    const meta = makeMeta();
    const chapter = makeChapter(1, {
      paragraphs: [
        { text: "The river town woke at dawn.", audio_path: `${baseUrl}/p0.m4a`, duration_seconds: 2 },
        { text: "Smoke rose from every chimney.", audio_path: `${baseUrl}/p1.m4a`, duration_seconds: 2 },
      ],
    });
    // resolveAssetUrl uses createSignedUrl for non-http refs; our refs are
    // http already, so supabase is barely touched.
    const supabase = { storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: "unused" } }) }) } } as unknown as SupabaseClient;
    const cdir = join(workDir, "chapters");
    await mkdir(cdir, { recursive: true });

    const out = await renderChapter(
      { cfg, supabase, job: { id: "r1", user_id: "u1" } as never, meta, cdir, isCancelled: async () => false },
      chapter,
      defaultContinuityBrief(),
    );
    const st = await stat(out);
    assert.ok(st.size > 10_000, `chapter mp4 size ${st.size}`);
    const dur = await probeDuration(FFPROBE, out);
    assert.ok(dur >= 3.5 && dur <= 5, `chapter duration ${dur}`);
  });

  it("stitchChapters concatenates without re-encoding", async () => {
    if (!BINARIES_OK) return;
    const cfg = makeCfg(workDir);
    const meta = makeMeta();
    const supabase = { storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: "unused" } }) }) } } as unknown as SupabaseClient;
    const cdir = join(workDir, "chapters2");
    await mkdir(cdir, { recursive: true });
    const paths: string[] = [];
    for (const i of [1, 2]) {
      const chapter = makeChapter(i, {
        paragraphs: [
          { text: `Chapter ${i} narration here.`, audio_path: `${baseUrl}/p0.m4a`, duration_seconds: 2 },
        ],
      });
      paths.push(
        await renderChapter(
          { cfg, supabase, job: { id: "r1", user_id: "u1" } as never, meta, cdir, isCancelled: async () => false },
          chapter,
          defaultContinuityBrief(),
        ),
      );
    }
    const final = await stitchChapters(cfg, paths, workDir);
    const dur = await probeDuration(FFPROBE, final);
    assert.ok(dur >= 3.5 && dur <= 5, `stitched duration ${dur}`);
  });

  it("stitchChapters rejects missing chapter outputs", async () => {
    if (!BINARIES_OK) return;
    const cfg = makeCfg(workDir);
    await assert.rejects(stitchChapters(cfg, [], workDir), /Nothing to stitch/);
    await assert.rejects(
      stitchChapters(cfg, [join(workDir, "nope.mp4")], workDir),
      /missing or empty/,
    );
  });
});
