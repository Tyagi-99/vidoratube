/**
 * End-to-end pipeline render test (run with: npx tsx --test src/*.test.ts).
 *
 * Renders a tiny 2-second fixture through the real worker pipeline
 * (runPipeline) for each supported aspect, then asserts via ffprobe:
 *   - H.264 High profile video at the correct per-aspect dimensions
 *   - AAC 48 kHz audio track
 *   - +faststart layout (moov box before mdat in the file)
 *
 * Skips gracefully when ffmpeg/ffprobe are not installed.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ASPECTS, runPipeline } from "./pipeline.js";
import type { RenderJob, RenderJobMeta } from "./types.js";

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";

function hasBinary(bin: string): boolean {
  try {
    const r = spawnSync(bin, ["-version"], { stdio: "ignore" });
    return r.status === 0;
  } catch {
    return false;
  }
}

const BINARIES_OK = hasBinary(FFMPEG) && hasBinary(FFPROBE);

let workDir = "";
let server: Server | null = null;
let baseUrl = "";

function runOrThrow(args: string[]): void {
  const r = spawnSync(FFMPEG, args, { stdio: "pipe" });
  if (r.status !== 0) {
    throw new Error(`ffmpeg ${args.join(" ")} failed: ${r.stderr.toString().slice(0, 500)}`);
  }
}

before(async () => {
  if (!BINARIES_OK) return;
  workDir = await mkdtemp(join(tmpdir(), "vidora-pipeline-test-"));

  // Fixtures: a still image and a 2s silent 48 kHz stereo AAC clip.
  const img = join(workDir, "img.png");
  const audio = join(workDir, "audio.m4a");
  runOrThrow(["-y", "-f", "lavfi", "-i", "testsrc2=size=640x480:rate=1", "-frames:v", "1", img]);
  runOrThrow([
    "-y",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=48000:cl=stereo",
    "-t",
    "2",
    "-c:a",
    "aac",
    audio,
  ]);

  // Serve fixtures over localhost HTTP (the pipeline downloads http(s) URLs
  // directly; storage-path signing needs a real Supabase client).
  server = createServer(async (req, res) => {
    try {
      const { readFile } = await import("node:fs/promises");
      if (req.url === "/img.png") {
        const buf = await readFile(img);
        res.writeHead(200, { "Content-Type": "image/png" });
        res.end(buf);
      } else if (req.url === "/audio.m4a") {
        const buf = await readFile(audio);
        res.writeHead(200, { "Content-Type": "audio/mp4" });
        res.end(buf);
      } else {
        res.writeHead(404);
        res.end();
      }
    } catch {
      res.writeHead(500);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

type Ctx = Parameters<typeof runPipeline>[0];

function makeCtx(aspect: "16:9" | "9:16" | "1:1", dir: string): Ctx {
  const meta: RenderJobMeta = {
    scenes: [
      {
        id: "s1",
        number: 1,
        narration: "",
        image: `${baseUrl}/img.png`,
        audio: `${baseUrl}/audio.m4a`,
        duration: 2,
        cues: [],
      },
    ],
    title: "Pipeline fixture",
    aspect,
    fps: 30,
    burnCaptions: false,
    musicUrl: null,
    musicVolume: 0.15,
    musicDucking: true,
    voiceoverUrl: null,
  };
  const job: RenderJob = {
    id: `fixture-${aspect.replace(":", "x")}`,
    user_id: "00000000-0000-0000-0000-000000000000",
    project_id: null,
    engine: "server_ffmpeg",
    status: "running",
    stage: "claimed",
    progress: 0,
    aspect_ratio: aspect,
    attempts: 1,
    max_attempts: 3,
    claimed_at: new Date().toISOString(),
    claimed_by: "test",
    checkpoint: {},
    cancel_requested: false,
    meta,
    error: null,
  };
  return {
    cfg: {
      SUPABASE_URL: "http://127.0.0.1:1",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key-12345",
      RENDER_BUCKET: "renders",
      FFMPEG_PATH: FFMPEG,
      FFPROBE_PATH: FFPROBE,
      WORKER_ID: "pipeline-render-test",
      POLL_INTERVAL_SEC: 5,
      WORK_DIR: workDir,
      CONCURRENCY: 1,
    },
    supabase: {} as unknown as SupabaseClient,
    job,
    meta,
    dir,
    hooks: {
      onStage: async () => {},
      isCancelled: async () => false,
    },
  };
}

function probeStreams(file: string): { video: any; audio: any } {
  const r = spawnSync(
    FFPROBE,
    ["-v", "quiet", "-print_format", "json", "-show_streams", file],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, `ffprobe failed on ${file}`);
  const parsed = JSON.parse(r.stdout) as { streams: any[] };
  const video = parsed.streams.find((s) => s.codec_type === "video");
  const audio = parsed.streams.find((s) => s.codec_type === "audio");
  assert.ok(video, "no video stream");
  assert.ok(audio, "no audio stream");
  return { video, audio };
}

/** True when the moov box precedes mdat (i.e. +faststart was applied). */
function moovBeforeMdat(file: string): boolean {
  const r = spawnSync(FFPROBE, ["-v", "trace", "-i", file], { encoding: "utf8" });
  const out = r.stderr;
  const moovIdx = out.search(/type:'moov'/);
  const mdatIdx = out.search(/type:'mdat'/);
  return moovIdx !== -1 && mdatIdx !== -1 && moovIdx < mdatIdx;
}

describe("pipeline render output (ffprobe assertions)", { skip: !BINARIES_OK }, () => {
  for (const aspect of ["16:9", "9:16", "1:1"] as const) {
    it(`renders ${aspect} as H.264 High + AAC 48kHz with faststart`, async () => {
      const dir = join(workDir, `job-${aspect.replace(":", "x")}`);
      const out = await runPipeline(makeCtx(aspect, dir));

      const { video, audio } = probeStreams(out);
      const dims = ASPECTS[aspect]!;
      assert.equal(video.codec_name, "h264", "video codec");
      assert.equal(video.profile, "High", "H.264 profile");
      assert.equal(video.width, dims.width, "width");
      assert.equal(video.height, dims.height, "height");
      assert.equal(audio.codec_name, "aac", "audio codec");
      assert.equal(audio.sample_rate, "48000", "audio sample rate");

      assert.ok(moovBeforeMdat(out), "moov must precede mdat (+faststart)");
    });
  }
});

if (!BINARIES_OK) {
  describe("pipeline render output (ffprobe assertions)", () => {
    it("skipped: ffmpeg/ffprobe not installed — install both to run the end-to-end render test", (t) => {
      t.skip("ffmpeg or ffprobe binary not found on PATH");
    });
  });
}
