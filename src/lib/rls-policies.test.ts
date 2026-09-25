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

function stripSqlComments(sql: string): string {
  // Remove /* … */ blocks, then -- line comments, so prose like
  // "-- Non-destructive: CREATE TABLE IF NOT EXISTS only" is never
  // mistaken for a real CREATE TABLE statement.
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

function tableNames(sql: string): string[] {
  const names = new Set<string>();
  const clean = stripSqlComments(sql);
  const re = /CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?([a-z_][a-z0-9_]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) names.add(m[1]!);
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
  "projects",
  "scenes",
  "renders",
  "video_jobs",
  "voiceovers",
  "captions",
  "content_assets",
  "youtube_connections",
  "credit_ledger",
  "api_usage",
  "content_items",
  "rights_decisions",
  "research_projects",
  "outlier_videos",
  "video_ideas",
  "youtube_api_cache",
  "characters",
  "asset_provenance",
  "thumbnails",
  "seo_metadata",
  "publish_jobs",
  "safety_scores",
  "subscriptions",
  "video_analytics",
  "channel_stats",
  "learning_insights",
  "platform_video_stats",
  "retention_curves",
  "nps_responses",
  "referrals",
  "workflow_jobs",
  "workflow_job_events",
  "creators",
  "creator_accounts",
  "content_duplicate_flags",
  "notifications",
  "render_chapters",
  "meta_connections",
  // Sprint 7-8 C: server-enforced approval records + publish warnings.
  // Owner SELECT only; NO client write policies (service-role writes only).
  "approvals",
  "publish_warnings",
];

/**
 * Workspace-member-scoped tables (Sprint 7-8 agency tier). Rows belong to a
 * workspace's member set, not a single user: a caller sees ONLY workspaces
 * they belong to, enforced by the SECURITY DEFINER membership helpers
 * (is_workspace_member/owner/editor/creator) or by inline policies that join
 * workspace_members and reference auth.uid(). Same invariants as
 * owner-scoped tables: RLS on, member-scoped policies present, no permissive
 * USING (true).
 */
const WORKSPACE_MEMBER_SCOPED_TABLES = [
  "workspaces",
  "workspace_members",
  "client_channels",
  "brand_kits",
  "workspace_approvals",
];

/** Tables intentionally readable/writable without auth (documented exceptions). */
const PUBLIC_BY_DESIGN: Record<string, string> = {
  // Anonymous contact form: anyone can INSERT; reads/updates are admin-only.
  contact_messages: "anon INSERT only",
  // Marketing content served to logged-out visitors.
  site_content: "public read",
  pricing_plans: "public read",
  plans: "public read (active = true only)",
  categories: "public read",
  niches: "public read",
  // Static blocklist checked at signup; no sensitive data, read-only.
  disposable_email_domains: "public read",
  // Royalty-free music catalog; no user data, intentionally public read
  // (D25) — writes are service-role only via the Jamendo sync.
  music_tracks: "public read (royalty-free catalog, no user data)",
  // Language catalog driving UI dropdowns; no user data, read-only for all.
  languages: "public read",
  // Per-language voice slots; no user data, read-only for all.
  language_voices: "public read",
  // Per-language quality-gate records; no user data, read-only for all
  // (service_role writes only).
  language_quality_gates: "public read",
  // Sprint 7-8 C: versioned safety-scoring rules (weights, thresholds,
  // deductions). Reference data like languages (D45/D63): no user data,
  // read-only for all, service-role writes only.
  safety_rules: "public read",
};

/**
 * Tables locked to service_role (and narrow admin reads) by design.
 * RLS is enabled; no policy grants anon/authenticated access, so the
 * default-deny applies. Documented here so a future open policy is a
 * deliberate, reviewed change.
 */
const SERVICE_ROLE_ONLY: Record<string, string> = {
  billing_events: "raw webhook events; service_role writes, no user reads",
  rate_limit_buckets: "rate limiter internals; service_role only, no policies by design",
  abuse_signals: "fraud signals; service_role writes, admin SELECT only",
  integrations: "provider integrations; admin only",
  user_roles: "role assignments; own-row SELECT, admin writes",
  worker_heartbeats: "worker liveness; service_role upserts, app reads via service-role fn",
  tts_cache: "synthesized audio cache; service_role only, no policies by design",
};

describe("RLS static audit", () => {
  const sql = allMigrationSql();
  const tables = tableNames(sql);

  it("discovers the expected tables", () => {
    for (const t of OWNER_SCOPED_TABLES) {
      expect(tables).toContain(t);
    }
  });

  it("agency membership helpers are SECURITY DEFINER and caller-scoped", () => {
    // The is_workspace_* helpers let policies check membership without
    // recursing into workspace_members' own RLS policies. A helper that is
    // not SECURITY DEFINER would re-trigger RLS (infinite recursion); a
    // helper that does not filter on auth.uid() would leak other users'
    // membership. Both properties are asserted here.
    const sql = allMigrationSql();
    for (const fn of [
      "is_workspace_member",
      "is_workspace_owner",
      "is_workspace_editor",
      "is_workspace_creator",
    ]) {
      const bodyRe = new RegExp(
        `CREATE OR REPLACE FUNCTION public\\.${fn}\\([^)]*\\)[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$`,
        "i",
      );
      const m = bodyRe.exec(sql);
      expect(m, `${fn}: helper function not found in migrations`).toBeTruthy();
      const def = m![0];
      const body = m![1]!;
      expect(def, `${fn}: must be SECURITY DEFINER`).toMatch(/SECURITY DEFINER/i);
      expect(
        body,
        `${fn}: helper must scope to the caller via auth.uid()`,
      ).toContain("auth.uid()");
      expect(
        body,
        `${fn}: helper must read workspace membership, not return a constant`,
      ).toMatch(/workspace_members|workspaces/i);
      expect(body, `${fn}: helper must not be permissive`).not.toMatch(
        /RETURN\s+true/i,
      );
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

  it("gives every workspace-member-scoped table a membership policy", () => {
    // Isolation proof at the policy level: each agency table must carry at
    // least one policy whose predicate references the caller's identity
    // (auth.uid()) against workspace_members, and none may be permissive.
    for (const table of WORKSPACE_MEMBER_SCOPED_TABLES) {
      const policies = policiesFor(sql, table);
      expect(policies.length, `${table}: no policies`).toBeGreaterThan(0);
      const memberPolicies = policies.filter(
        (p) =>
          (p.includes("auth.uid()") && /workspace_members/i.test(p)) ||
          /is_workspace_(member|owner|editor|creator)\s*\(/i.test(p),
      );
      expect(
        memberPolicies.length,
        `${table}: no workspace-membership-scoped policy (inline auth.uid() predicate or is_workspace_* helper)`,
      ).toBeGreaterThan(0);
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

  it("keeps service-role-only tables locked to non-user roles", () => {
    // These tables must have RLS enabled and no policy that grants
    // ungated writes to anon/authenticated (admin-gated policies are fine).
    for (const table of Object.keys(SERVICE_ROLE_ONLY)) {
      expect(rlsEnabled(sql, table), `${table}: RLS not enabled`).toBe(true);
      const policies = policiesFor(sql, table);
      const ungatedUserWrite = policies.some(
        (p) =>
          /TO\s+(anon|authenticated|public)/i.test(p) &&
          /FOR\s+(ALL|INSERT|UPDATE|DELETE)/i.test(p) &&
          !/auth\.uid\(\)/i.test(p) &&
          !/has_role/i.test(p),
      );
      expect(ungatedUserWrite, `${table}: ungated user-role write policy found`).toBe(false);
    }
  });

  it("classifies every table in the migrations", () => {
    // A new table must be deliberately placed in one of the three lists.
    const known = new Set([
      ...OWNER_SCOPED_TABLES,
      ...WORKSPACE_MEMBER_SCOPED_TABLES,
      ...Object.keys(PUBLIC_BY_DESIGN),
      ...Object.keys(SERVICE_ROLE_ONLY),
    ]);
    const unclassified = tables.filter((t) => !known.has(t));
    expect(unclassified, `unclassified tables: ${unclassified.join(", ")}`).toEqual([]);
  });
});
