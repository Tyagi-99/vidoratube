#!/usr/bin/env node
/**
 * Fetch the FFmpeg.wasm core binary into public/wasm/ so the browser renderer
 * works in local dev and on any deployment — not just Lovable hosting.
 *
 * The 32 MB binary is intentionally NOT committed to git. The committed
 * `src/lib/render/ffmpeg-core-wasm.asset.json` remains the canonical source
 * for the expected size and the Lovable-hosted fallback URL; the loader tries
 * the local file first and falls back to that URL.
 *
 * Source: $FFMPEG_WASM_URL, or https://vidoratube.lovable.app + the asset path.
 * Skips the download when a valid copy already exists. Exits non-zero on
 * verification failure so `prebuild` fails loudly instead of shipping a
 * renderer that cannot start.
 */
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const asset = JSON.parse(
  readFileSync(join(root, "src/lib/render/ffmpeg-core-wasm.asset.json"), "utf8"),
);
const target = join(root, "public/wasm/ffmpeg-core.wasm");
const expectedSize = Number(asset.size);
const sourceUrl = process.env["FFMPEG_WASM_URL"] ?? `https://vidoratube.lovable.app${asset.url}`;

const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d]);

function isValid(path) {
  try {
    const buf = readFileSync(path);
    return buf.length === expectedSize && buf.subarray(0, 4).equals(WASM_MAGIC);
  } catch {
    return false;
  }
}

if (existsSync(target) && isValid(target)) {
  console.log(`[ffmpeg-wasm] already valid (${expectedSize} bytes), skipping download.`);
  process.exit(0);
}

console.log(`[ffmpeg-wasm] downloading ${sourceUrl} ...`);
mkdirSync(dirname(target), { recursive: true });
const res = await fetch(sourceUrl);
if (!res.ok || !res.body) {
  console.error(`[ffmpeg-wasm] download failed: HTTP ${res.status}`);
  process.exit(1);
}
const tmp = `${target}.part`;
await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));

if (!isValid(tmp)) {
  try {
    unlinkSync(tmp);
  } catch {
    /* ignore */
  }
  console.error("[ffmpeg-wasm] verification failed (size or magic-bytes mismatch).");
  process.exit(1);
}
renameSync(tmp, target);
console.log(`[ffmpeg-wasm] verified ${expectedSize} bytes -> public/wasm/ffmpeg-core.wasm`);
