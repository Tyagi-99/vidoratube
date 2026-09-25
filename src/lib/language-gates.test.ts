import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  gatePassed,
  LANGUAGE_QUALITY_GATES,
} from "./languages";
import { VOICE_CATALOG } from "./voices";

/**
 * Sprint 3-4 item 4: the language quality gate as data + test.
 *
 * A language may only be status='live' when all three checks pass:
 *   (a) 3 golden scripts rendered acceptably,
 *   (b) back-translation check,
 *   (c) native-speaker review sign-off.
 *
 * The production record is the `language_quality_gates` table (seeded by
 * supabase/migrations/20260925233000_language_voices_and_gates.sql); the
 * checked-in CI mirror is LANGUAGE_QUALITY_GATES in src/lib/languages.ts.
 * These tests FAIL if any 'live' language lacks all three passing checks,
 * and they keep the migration seed, the data mirror, and the voice-slot
 * structure in sync.
 */

const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/migrations");

function migrationSql(match: RegExp): string {
  const file = readdirSync(MIGRATIONS_DIR).find((f) => match.test(f));
  expect(file, `migration matching ${match} not found`).toBeTruthy();
  return readFileSync(join(MIGRATIONS_DIR, file!), "utf8");
}

/** 'live' language codes from the languages seed migration. */
function liveCodesFromSeed(): string[] {
  const sql = migrationSql(/languages_table/);
  const block = sql.split("insert into languages")[1]!.split("on conflict")[0]!;
  const codes: string[] = [];
  const re =
    /\('([a-z]{2})',\s*'[^']*',\s*'[^']*',\s*(?:true|false),\s*'[^']*',\s*\d+,\s*'(live|beta|planned)'\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    if (m[2] === "live") codes.push(m[1]!);
  }
  return codes;
}

type VoiceRow = {
  code: string;
  slot: number;
  provider: string;
  providerVoiceId: string | null;
  verified: boolean;
  selectable: boolean;
};

function voiceRows(): VoiceRow[] {
  const sql = migrationSql(/language_voices_and_gates/);
  const block = sql
    .split("insert into public.language_voices")[1]!
    .split("on conflict")[0]!;
  const rows: VoiceRow[] = [];
  const re =
    /^\s*\('([a-z]{2})',\s*(\d+),\s*'[^']*',\s*'(?:masculine|feminine|neutral)',\s*'(elevenlabs|gateway|none)',\s*(NULL|'[^']*'),\s*(true|false),\s*(true|false)\),?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const idRaw = m[6]!;
    rows.push({
      code: m[1]!,
      slot: Number(m[2]),
      provider: m[5]!,
      providerVoiceId: idRaw === "NULL" ? null : idRaw.slice(1, -1),
      verified: m[7] === "true",
      selectable: m[8] === "true",
    });
  }
  return rows;
}

type GateRow = {
  code: string;
  golden: boolean;
  goldenEvidence: string;
  back: boolean;
  backEvidence: string;
  native: boolean;
  nativeEvidence: string;
};

function gateRows(): GateRow[] {
  const sql = migrationSql(/language_voices_and_gates/);
  const block = sql
    .split("insert into public.language_quality_gates")[1]!
    .split("on conflict")[0]!;
  const rows: GateRow[] = [];
  const re =
    /^\s*\('([a-z]{2})',\s*(true|false),\s*'([^']*)',\s*(true|false),\s*'([^']*)',\s*(true|false),\s*'([^']*)'\),?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    rows.push({
      code: m[1]!,
      golden: m[2] === "true",
      goldenEvidence: m[3]!,
      back: m[4] === "true",
      backEvidence: m[5]!,
      native: m[6] === "true",
      nativeEvidence: m[7]!,
    });
  }
  return rows;
}

describe("quality gate: live languages must pass all three checks", () => {
  it("the languages seed marks exactly English as live", () => {
    expect(liveCodesFromSeed()).toEqual(["en"]);
  });

  it("every live language passes the gate in the CI data mirror", () => {
    const byCode = new Map(LANGUAGE_QUALITY_GATES.map((g) => [g.code, g]));
    for (const code of liveCodesFromSeed()) {
      const gate = byCode.get(code);
      expect(gate, `${code}: no gate record`).toBeTruthy();
      expect(gate!.status).toBe("live");
      expect(gatePassed(gate!), `${code}: gate not fully passed`).toBe(true);
    }
  });

  it("every live language passes the gate in the migration seed", () => {
    const byCode = new Map(gateRows().map((r) => [r.code, r]));
    expect(byCode.size).toBe(12);
    for (const code of liveCodesFromSeed()) {
      const row = byCode.get(code);
      expect(row, `${code}: no gate row in migration`).toBeTruthy();
      expect(
        row!.golden && row!.back && row!.native,
        `${code}: migration gate row not fully passed`,
      ).toBe(true);
      for (const ev of [row!.goldenEvidence, row!.backEvidence, row!.nativeEvidence]) {
        expect(ev.trim().length, `${code}: empty evidence`).toBeGreaterThan(0);
      }
    }
  });

  it("migration gate flags match the CI data mirror per language", () => {
    const data = new Map(LANGUAGE_QUALITY_GATES.map((g) => [g.code, g]));
    for (const row of gateRows()) {
      const g = data.get(row.code);
      expect(g, `${row.code}: gate row missing from data mirror`).toBeTruthy();
      expect(row.golden).toBe(g!.goldenScripts.passed);
      expect(row.back).toBe(g!.backTranslation.passed);
      expect(row.native).toBe(g!.nativeReview.passed);
      expect(g!.status === "live").toBe(
        row.golden && row.back && row.native,
      );
    }
  });

  it("no beta language is marked live in either record", () => {
    for (const g of LANGUAGE_QUALITY_GATES) {
      if (g.code !== "en") expect(g.status).toBe("beta");
    }
  });
});

describe("voice slots: 4 per language, placeholders unverifiable", () => {
  it("seeds exactly 4 slots for each of the 12 languages", () => {
    const rows = voiceRows();
    expect(rows.length).toBe(48);
    const byCode = new Map<string, number[]>();
    for (const r of rows) {
      byCode.set(r.code, [...(byCode.get(r.code) ?? []), r.slot]);
    }
    expect([...byCode.keys()].sort()).toEqual(
      ["ar", "bn", "de", "en", "es", "fr", "hi", "id", "ja", "pt", "ur", "zh"].sort(),
    );
    for (const slots of byCode.values()) {
      expect(slots.sort()).toEqual([1, 2, 3, 4]);
    }
  });

  it("verified slots carry provider ids; placeholders carry none and are not selectable", () => {
    for (const r of voiceRows()) {
      if (r.verified) {
        expect(r.providerVoiceId, `${r.code}#${r.slot}: verified without id`).toBeTruthy();
      } else {
        expect(r.provider).toBe("none");
        expect(r.providerVoiceId).toBeNull();
        expect(r.selectable).toBe(false);
      }
      // selectable implies verified — the UI never offers unverified voices
      if (r.selectable) expect(r.verified).toBe(true);
    }
  });

  it("verified provider ids all exist in the in-code voice catalog", () => {
    const catalogIds = new Set(
      VOICE_CATALOG.map((v) => v.providerVoiceId).filter(Boolean),
    );
    const verified = voiceRows().filter((r) => r.verified && r.selectable);
    expect(verified.length).toBeGreaterThan(0);
    for (const r of verified) {
      expect(
        catalogIds.has(r.providerVoiceId),
        `${r.code}#${r.slot}: id not found in VOICE_CATALOG`,
      ).toBe(true);
    }
  });

  it("only English and Hindi have verified/selectable slots", () => {
    const codes = new Set(
      voiceRows().filter((r) => r.selectable).map((r) => r.code),
    );
    expect([...codes].sort()).toEqual(["en", "hi"]);
  });
});
