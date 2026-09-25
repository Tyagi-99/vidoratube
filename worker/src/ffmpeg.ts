import { spawn, type ChildProcess } from "node:child_process";

export class FFmpegCancelled extends Error {
  constructor() {
    super("FFmpeg cancelled");
    this.name = "FFmpegCancelled";
  }
}

export type FFmpegProgress = {
  /** seconds of output written so far */
  outTimeSec: number;
  speed: number;
};

/**
 * Run FFmpeg, streaming `-progress` key=value pairs.
 *
 * - `onProgress` receives parsed progress updates.
 * - `isCancelled` is polled; when true the process is killed and
 *   FFmpegCancelled is thrown.
 * - Resolves when FFmpeg exits 0; rejects on non-zero exit or spawn error.
 */
export function runFFmpeg(opts: {
  ffmpegPath: string;
  args: string[];
  onProgress?: (p: FFmpegProgress) => void;
  isCancelled?: () => boolean | Promise<boolean>;
  timeoutMs?: number;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn(opts.ffmpegPath, opts.args, {
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderrTail = "";
    let outTimeMs = 0;
    let speed = 0;
    let settled = false;

    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearInterval(cancelTimer);
      if (timeout) clearTimeout(timeout);
      if (err) reject(err);
      else resolve();
    };

    const cancelTimer = setInterval(() => {
      void (async () => {
        if (await opts.isCancelled?.()) {
          child.kill("SIGKILL");
          done(new FFmpegCancelled());
        }
      })();
    }, 500);

    let timeout: NodeJS.Timeout | undefined;
    if (opts.timeoutMs) {
      timeout = setTimeout(() => {
        child.kill("SIGKILL");
        done(new Error(`FFmpeg timed out after ${opts.timeoutMs}ms`));
      }, opts.timeoutMs);
      timeout.unref?.();
    }

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderrTail = (stderrTail + text).slice(-4000);
      for (const line of text.split("\n")) {
        const t = line.trim();
        if (t.startsWith("out_time_ms=")) {
          outTimeMs = Number(t.slice("out_time_ms=".length)) || 0;
        } else if (t.startsWith("speed=")) {
          speed = parseFloat(t.slice("speed=".length)) || 0;
        } else if (t === "progress=end") {
          opts.onProgress?.({ outTimeSec: outTimeMs / 1_000_000, speed });
        }
      }
      // Emit throttled progress on out_time updates
      if (text.includes("out_time_ms=")) {
        opts.onProgress?.({ outTimeSec: outTimeMs / 1_000_000, speed });
      }
    });

    child.on("error", (err) => done(err));
    child.on("close", (code, signal) => {
      if (signal === "SIGKILL" && opts.isCancelled?.()) {
        done(new FFmpegCancelled());
      } else if (code === 0) {
        done();
      } else {
        done(
          new Error(
            `FFmpeg exited with code ${code ?? `signal ${signal}`}: ${stderrTail.slice(-500)}`,
          ),
        );
      }
    });
  });
}

/** Probe media duration in seconds via ffprobe. */
export function probeDuration(ffprobePath: string, file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffprobePath,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        file,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    child.stdout?.on("data", (c: Buffer) => (out += c.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exited ${code}`));
      const d = parseFloat(out.trim());
      if (!Number.isFinite(d)) return reject(new Error("ffprobe: no duration"));
      resolve(d);
    });
  });
}
