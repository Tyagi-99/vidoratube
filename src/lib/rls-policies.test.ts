import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static RLS audit: parses every migration in supabase/migrations and asserts
 * that each table has Row Level Security enabled and that owner-scoped tables
 * actually carry an owner policy.
 *
 * This is a guardrail, not a proof of runtime isolation: it catches the
 * "new table without RLS" and "policy dropped by a later migration" classes of
 * regression in CI. True owner-isolation (user A cannot read user B's rows)
 * needs a live database; see supabase/tests/ for the SQL assertions to run
 * against a real instance.
 */

const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/migrations");

function allMigrationSql(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  expect(files.length).toBeGreaterThan(0);
  return files.map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8")).join("\n");
}

function tableNames(sql: string): string[] {
  const names = new Set<string>();
  const re = /CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?([a-z_][a-z0-9_]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) names.add(m[1]!);
  return [...names].sort();
}

function rlsEnabled(sql: string, table: string): boolean {
  const re = new RegExp(
    `ALTER TABLE (?:public\\.)?${table}\\s+ENABLE ROW LEVEL SECURITY`,
    "i",
  );
  return re.test(sql);
}

/** Raw CREATE POLICY statements mentioning the table. */
function policiesFor(sql: string, table: string): string[] {
  const out: string[] = [];
  const re = new RegExp(
    `CREATE POLICY[^;]*?ON (?:public\\.)?${table}[^;]*?;`,
    "gis",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) out.push(m[0]);
  return out;
}

/** Tables whose rows belong to a single user and must never be cross-readable. */
const OWNER_SCOPED_TABLES = [
  "profiles",
  "video_jobs",
  "youtube_connections",
  "credit_ledger",
  "content_items",
  "research_projects",
  "outlier_videos",
  "video_ideas",
  "youtube_api_cache",
];

/** Tables intentionally readable/writable without auth (documented exceptions). */
const PUBLIC_BY_DESIGN: Record<string, string> = {
  // Anonymous contact form: anyone can INSERT; reads/updates are admin-only.
  contact_messages: "anon INSERT only",
  // Marketing content served to logged-out visitors.
  site_content: "public read",
  pricing_plans: "public read",
  categories: "public read",
  niches: "public read",
  // Static blocklist checked at signup; no sensitive data, read-only.
  disposable_email_domains: "public read",
};

describe("RLS static audit", () => {
  const sql = allMigrationSql();
  const tables = tableNames(sql);

  it("discovers the expected tables", () => {
    for (const t of OWNER_SCOPED_TABLES) {
      expect(tables).toContain(t);
    }
  });

  it("enables ROW LEVEL SECURITY on every table", () => {
    const missing = tables.filter((t) => !rlsEnabled(sql, t));
    expect(missing).toEqual([]);
  });

  it("gives every owner-scoped table an auth.uid() owner policy", () => {
    for (const table of OWNER_SCOPED_TABLES) {
      const policies = policiesFor(sql, table);
      expect(policies.length).toBeGreaterThan(0);
      const ownerPolicies = policies.filter((p) => p.includes("auth.uid()"));
      expect(
        ownerPolicies.length,
        `${table}: no policy references auth.uid()`,
      ).toBeGreaterThan(0);
    }
  });

  it("has no permissive USING (true) / WITH CHECK (true) on owner-scoped tables", () => {
    for (const table of OWNER_SCOPED_TABLES) {
      const policies = policiesFor(sql, table);
      const permissive = policies.filter(
        (p) => /USING\s*\(\s*true\s*\)/i.test(p) || /WITH CHECK\s*\(\s*true\s*\)/i.test(p),
      );
      expect(permissive, `${table}: permissive policy found`).toEqual([]);
    }
  });

  it("documents every intentionally-public table", () => {
    // Any table with a fully-open policy must be listed in PUBLIC_BY_DESIGN
    // with its justification, so new open tables can't slip in unnoticed.
    for (const table of tables) {
      const policies = policiesFor(sql, table);
      const hasOpenPolicy = policies.some(
        (p) => /USING\s*\(\s*true\s*\)/i.test(p) || /WITH CHECK\s*\(\s*true\s*\)/i.test(p),
      );
      if (hasOpenPolicy) {
        expect(
          PUBLIC_BY_DESIGN[table],
          `${table} has an open policy but is not documented in PUBLIC_BY_DESIGN`,
        ).toBeTruthy();
      }
    }
  });
});
