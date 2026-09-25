import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALL_ASPECTS,
  ASPECT_RESOLUTIONS,
  buildServerRenderRows,
  resolveRenderAspects,
} from "./server-renders.functions";

/**
 * Sprint 1-2: render queue hardening.
 *
 * - Multi-aspect enqueue: one `renders` row per aspect, linked by a shared
 *   meta.group_id (pure logic, tested here without a database).
 * - `requeue_stale_renders` RPC: static migration audit (definition, lease
 *   default, service_role-only execution, retry-cap semantics). The live
 *   behavioral tests (two sequential claims, stale requeue, retry cap,
 *   RLS owner isolation) run against a real database via
 *   supabase/tests/render_queue.sql.
 */

const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/migrations");

function allMigrationSql(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files.map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8")).join("\n");
}

function requeueSql(): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) =>
    f.includes("requeue_stale_renders"),
  );
  expect(files.length).toBeGreaterThan(0);
  return files
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n");
}

function makeInput(
  overrides: Partial<Parameters<typeof buildServerRenderRows>[0]["input"]> = {},
): Parameters<typeof buildServerRenderRows>[0]["input"] {
  return {
    projectId: "11111111-1111-4111-8111-111111111111",
    title: "Test video",
    scenes: [
      {
        id: "s1",
        number: 1,
        narration: "hello",
        image: "https://example.com/img.png",
        audio: null,
        duration: 5,
        cues: [],
      },
    ],
    fps: 30,
    burnCaptions: false,
    musicUrl: null,
    musicVolume: 0.15,
    musicDucking: true,
    voiceoverUrl: null,
    mode: "story" as const,
    ...overrides,
  };
}

describe("resolveRenderAspects", () => {
  it("uses an explicit aspects list as-is", () => {
    expect(resolveRenderAspects({ aspects: ["9:16"] })).toEqual(["9:16"]);
  });

  it("dedupes repeated aspects", () => {
    expect(resolveRenderAspects({ aspects: ["1:1", "1:1", "16:9"] })).toEqual([
      "1:1",
      "16:9",
    ]);
  });

  it("falls back to a legacy single aspect (RenderPanel back-compat)", () => {
    expect(resolveRenderAspects({ aspect: "9:16" })).toEqual(["9:16"]);
  });

  it("prefers aspects over aspect when both are given", () => {
    expect(
      resolveRenderAspects({ aspects: ["1:1"], aspect: "9:16" }),
    ).toEqual(["1:1"]);
  });

  it("defaults to all three aspects", () => {
    expect(resolveRenderAspects({})).toEqual(["16:9", "9:16", "1:1"]);
    expect(resolveRenderAspects({})).toEqual(ALL_ASPECTS);
  });
});

describe("buildServerRenderRows", () => {
  const userId = "22222222-2222-4222-8222-222222222222";
  const groupId = "33333333-3333-4333-8333-333333333333";

  it("creates one row per aspect with a shared group id", () => {
    const rows = buildServerRenderRows({ userId, groupId, input: makeInput() });
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.user_id).toBe(userId);
      expect(row.project_id).toBe("11111111-1111-4111-8111-111111111111");
      expect(row.engine).toBe("server_ffmpeg");
      expect(row.status).toBe("queued");
      expect((row.meta as { group_id: string }).group_id).toBe(groupId);
    }
    // Each row carries its own aspect in meta + top-level columns.
    const byAspect = Object.fromEntries(
      rows.map((r) => [(r.meta as { aspect: string }).aspect, r]),
    );
    expect(Object.keys(byAspect).sort()).toEqual(["16:9", "1:1", "9:16"]);
    for (const aspect of ALL_ASPECTS) {
      const row = byAspect[aspect]!;
      expect(row.aspect_ratio).toBe(aspect);
      expect(row.resolution).toBe(ASPECT_RESOLUTIONS[aspect]);
    }
  });

  it("gives every row a unique id", () => {
    const rows = buildServerRenderRows({ userId, groupId, input: makeInput() });
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("renders a subset when aspects is explicit", () => {
    const rows = buildServerRenderRows({
      userId,
      groupId,
      input: makeInput({ aspects: ["9:16"] }),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.aspect_ratio).toBe("9:16");
    expect(rows[0]!.resolution).toBe("1080x1920");
  });

  it("renders exactly the legacy aspect when only aspect is passed", () => {
    const rows = buildServerRenderRows({
      userId,
      groupId,
      input: makeInput({ aspect: "1:1" }),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.resolution).toBe("1080x1080");
  });

  it("keeps the scene payload identical across aspect rows", () => {
    const rows = buildServerRenderRows({ userId, groupId, input: makeInput() });
    const metas = rows.map((r) => r.meta as { scenes: unknown[]; title: string });
    for (const m of metas) {
      expect(m.title).toBe("Test video");
      expect(m.scenes).toHaveLength(1);
    }
    expect(metas[0]!.scenes).toEqual(metas[1]!.scenes);
  });
});

describe("requeue_stale_renders migration (static audit)", () => {
  const sql = requeueSql();

  it("defines the function with a 300s default lease", () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.requeue_stale_renders\(\s*p_lease_seconds\s+integer\s+DEFAULT\s+300\s*\)/i,
    );
  });

  it("runs SECURITY DEFINER with a locked search_path", () => {
    expect(sql).toMatch(/SECURITY DEFINER/i);
    expect(sql).toMatch(/SET\s+search_path\s*=\s*public/i);
  });

  it("is executable only by service_role", () => {
    expect(sql).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.requeue_stale_renders\(integer\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i,
    );
    expect(sql).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.requeue_stale_renders\(integer\)\s+TO\s+service_role/i,
    );
  });

  it("requeues stale jobs with attempts < max_attempts (attempts incremented)", () => {
    expect(sql).toMatch(/status\s*=\s*'running'/i);
    expect(sql).toMatch(/engine\s*=\s*'server_ffmpeg'/i);
    expect(sql).toMatch(/claimed_at\s*<\s*now\(\)\s*-\s*make_interval\(secs\s*=>\s*p_lease_seconds\)/i);
    expect(sql).toMatch(/attempts\s*=\s*attempts\s*\+\s*1/i);
    expect(sql).toMatch(/SET\s+status\s*=\s*'queued'/i);
  });

  it("fails jobs whose retry budget is exhausted with the terminal error", () => {
    expect(sql).toMatch(/attempts\s*>=\s*max_attempts/i);
    expect(sql).toMatch(/status\s*=\s*'failed'/i);
    expect(sql).toMatch(/'Worker died; retries exhausted'/);
  });

  it("is non-destructive (no DELETE/UPDATE of user data, no DROP)", () => {
    expect(sql).not.toMatch(/^\s*DELETE\s+FROM\s+public\./im);
    expect(sql).not.toMatch(/DROP\s+(TABLE|FUNCTION)/i);
  });
});

describe("renders RLS owner isolation (static audit)", () => {
  it("keeps an auth.uid() owner policy on renders so users can't read others' rows", () => {
    const sql = allMigrationSql();
    const policies = [...sql.matchAll(/CREATE POLICY[^;]*?ON (?:public\.)?renders[^;]*?;/gis)].map(
      (m) => m[0],
    );
    expect(policies.length).toBeGreaterThan(0);
    const owner = policies.filter(
      (p) => p.includes("auth.uid()") && p.includes("user_id"),
    );
    expect(owner.length).toBeGreaterThan(0);
    // No permissive policy may ever open renders to everyone.
    for (const p of policies) {
      expect(p).not.toMatch(/USING\s*\(\s*true\s*\)/i);
      expect(p).not.toMatch(/WITH CHECK\s*\(\s*true\s*\)/i);
    }
  });
});
