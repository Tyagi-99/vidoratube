#!/usr/bin/env node
/**
 * P9: i18n completeness check.
 *
 * Fails (exit 1) when any English key in src/lib/i18n.ts lacks a Hindi
 * translation, or when a Hindi value is an empty string. Run in CI via
 * `npm run i18n:check`.
 *
 * It parses the two dictionary literals with a lightweight line scanner —
 * no TS toolchain needed.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(root, "..", "src", "lib", "i18n.ts"), "utf8");

function extractKeys(dictName) {
  // Find "const <dictName> = {" ... "};" and capture the block.
  const start = new RegExp(`const ${dictName}[^=]*=\\s*\\{`);
  const m = start.exec(src);
  if (!m) throw new Error(`dictionary ${dictName} not found`);
  let depth = 0;
  let i = m.index + m[0].length - 1;
  let block = "";
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        block += ch;
        break;
      }
    }
    block += ch;
  }
  const keys = new Map();
  for (const line of block.split("\n")) {
    const km = /^\s*([a-zA-Z0-9_]+)\s*:\s*(.+)$/.exec(line.trimEnd());
    if (!km) continue;
    keys.set(km[1], km[2].trim());
  }
  return keys;
}

const en = extractKeys("en");
const hi = extractKeys("hi");

let failures = 0;
for (const key of en.keys()) {
  if (!hi.has(key)) {
    console.error(`MISSING Hindi key: ${key}`);
    failures++;
  } else if (/^(""|'')\s*,?$/.test(hi.get(key))) {
    console.error(`EMPTY Hindi value: ${key}`);
    failures++;
  }
}
for (const key of hi.keys()) {
  if (!en.has(key)) {
    console.error(`ORPHAN Hindi key (no English): ${key}`);
    failures++;
  }
}

console.log(`i18n check: ${en.size} en keys, ${hi.size} hi keys, ${failures} problem(s)`);
process.exit(failures > 0 ? 1 : 0);
