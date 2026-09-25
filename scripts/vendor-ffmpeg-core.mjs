#!/usr/bin/env node
/**
 * Vendor the FFmpeg.wasm core files into public/wasm/ from the pinned
 * @ffmpeg/core npm dependency, so the browser renderer works in local dev
 * and on any deployment — not just Lovable hosting.
 *
 * Why copy instead of committing:
 * - public/wasm/ffmpeg-core-esm.js was a committed manual duplicate of
 *   node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js; copying at build time
 *   keeps the served core JS in sync with the pinned @ffmpeg/core version.
 * - The 32 MB ffmpeg-core.wasm is gitignored (see .gitignore).
 *
 * Cloudflare Workers Static Assets reject files > 25 MB, so the wasm is
 * vendored for `dev` (predev) but NOT for production builds by default —
 * production keeps using the Lovable-hosted fallback URL (the loader in
 * browser-render.ts tries /wasm/ffmpeg-core.wasm first, then falls back).
 * Set VIDORA_VENDOR_WASM=1 when building for a self-hosted production
 * target to get a fully self-contained dist/ instead.
 *
 * Usage:
 *   node scripts/vendor-ffmpeg-core.mjs --dev    # predev: vendor js + wasm
 *   node scripts/vendor-ffmpeg-core.mjs --build  # prebuild: vendor js (+ wasm iff VIDORA_VENDOR_WASM=1)
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const esmDir = join(root, "node_modules/@ffmpeg/core/dist/esm");
const srcJs = join(esmDir, "ffmpeg-core.js");
const srcWasm = join(esmDir, "ffmpeg-core.wasm");
const outDir = join(root, "public/wasm");
const outJs = join(outDir, "ffmpeg-core-esm.js");
const outWasm = join(outDir, "ffmpeg-core.wasm");

const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d]);
const mode = process.argv.includes("--dev") ? "dev" : "build";

function fail(message) {
  console.error(`[ffmpeg-core] ${message}`);
  process.exit(1);
}

if (!existsSync(srcJs) || !existsSync(srcWasm)) {
  fail(`@ffmpeg/core esm files not found in ${esmDir} — run the package manager install first.`);
}

mkdirSync(outDir, { recursive: true });

// The core JS is small (111 KB) and safe for every deploy target: always vendor.
copyFileSync(srcJs, outJs);
const jsSize = readFileSync(outJs).length;
if (jsSize < 50_000) fail(`copied core JS looks wrong (${jsSize} bytes).`);
console.log(`[ffmpeg-core] vendored ffmpeg-core-esm.js (${jsSize} bytes)`);

// The wasm exceeds Cloudflare Workers' 25 MB static-asset limit: only vendor it
// for local dev, or for production builds that explicitly opt in.
const wantWasm = mode === "dev" || process.env["VIDORA_VENDOR_WASM"] === "1";
if (wantWasm) {
  copyFileSync(srcWasm, outWasm);
  const buf = readFileSync(outWasm);
  if (buf.length < 30_000_000 || !buf.subarray(0, 4).equals(WASM_MAGIC)) {
    fail(`copied wasm failed verification (${buf.length} bytes).`);
  }
  console.log(`[ffmpeg-core] vendored ffmpeg-core.wasm (${buf.length} bytes)`);
} else if (existsSync(outWasm)) {
  // A dev-vendored copy must not leak into dist/ and break the Cloudflare deploy.
  rmSync(outWasm);
  console.log("[ffmpeg-core] removed dev-vendored ffmpeg-core.wasm for production build (set VIDORA_VENDOR_WASM=1 to keep it)");
} else {
  console.log("[ffmpeg-core] skipping ffmpeg-core.wasm for production build (set VIDORA_VENDOR_WASM=1 to vendor it)");
}
