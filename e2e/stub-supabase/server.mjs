#!/usr/bin/env node
/**
 * Deterministic Supabase stub for VidoraTube E2E tests (Phase 6, Stream A).
 *
 * Implements just enough of the Supabase HTTP surface for the E2E workflows:
 *   - GoTrue auth: signup / signin (password) / refresh / getUser / update / logout
 *   - PostgREST-ish CRUD: GET/POST/PATCH/DELETE /rest/v1/<table> with
 *     eq/neq/lt/lte/gt/gte/in/is filters, `not.` negation, order, limit,
 *     offset, count=exact, and .single() semantics
 *   - The credit RPCs with the SAME semantics as the SQL migrations
 *     (debit_credits_for_minutes, refund_credits_for_minutes,
 *      debit_credits_for_job_once, adjust_credits, grant_credits_once,
 *      check_rate_limit, log_abuse_signal)
 *
 * State is in-memory and deterministic. Every response carries
 * `x-vidora-e2e-stub: deterministic-supabase-stub` so nothing here can be
 * mistaken for the real backend.
 *
 * This is TEST INFRASTRUCTURE. It never touches real Supabase, real provider
 * APIs, or real money. It is only started by `node e2e/serve.mjs` for
 * `npm run test:e2e`.
 */

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.E2E_STUB_PORT ?? 54321);
const HOST = "127.0.0.1";

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

/** email -> { id, email, password, user_metadata, created_at } */
const users = new Map();
/** accessToken -> userId ; refreshToken -> userId */
const sessions = new Map();
/** tableName -> row[] */
const tables = new Map();

/**
 * Column DEFAULTs mirrored from supabase/migrations/*.sql. PostgREST applies
 * these server-side on INSERT; the stub applies them here so rows the app
 * creates without explicit values (e.g. scripts.status) match production.
 * Keys are table names; values are column -> default (fresh objects per row
 * are produced by structuredClone at insert time).
 */
const COLUMN_DEFAULTS = {
  scripts: {
    title: "Untitled script",
    status: "draft",
    word_count: 0,
    metadata: {},
  },
  script_versions: {
    sections: [],
    full_text: "",
    word_count: 0,
  },
  projects: {
    title: "Untitled project",
    topic: "",
    mode: "stock",
    preset: "documentary",
    visual_style: "cinematic_realistic",
    language: "English",
    duration_minutes: 5,
    aspect_ratio: "16:9",
    status: "draft",
    stage: "created",
    step: "Ready to generate",
  },
  render_jobs: {
    type: "mp4",
    engine: "browser_ffmpeg",
    status: "queued",
    format: "mp4",
    meta: {},
  },
};

function table(name) {
  if (!tables.has(name)) tables.set(name, []);
  return tables.get(name);
}

function reset() {
  users.clear();
  sessions.clear();
  tables.clear();
  seedStatic();
}

/**
 * Deterministic seed rows mirrored from supabase/migrations seed INSERTs.
 * These are public/reference data the app reads without auth (e.g. the
 * pricing page). Installed on every reset so tests see production values.
 */
function seedStatic() {
  tables.set(
    "pricing_plans",
    [
      {
        slug: "starter",
        name: "Starter",
        price_monthly: 19,
        price_monthly_inr: 1599,
        credits: 20,
        blurb: "For your first uploads",
        features: [
          "20 video credits / month",
          "1080p exports",
          "40+ AI voices",
          "Auto captions",
          "Email support",
        ],
        highlighted: false,
        sort_order: 1,
        active: true,
      },
      {
        slug: "studio",
        name: "Studio",
        price_monthly: 49,
        price_monthly_inr: 3999,
        credits: 70,
        blurb: "For creators shipping weekly",
        features: [
          "70 video credits / month",
          "4K exports",
          "Voice cloning",
          "Brand kit + custom fonts",
          "Priority rendering",
          "Priority support",
        ],
        highlighted: true,
        sort_order: 2,
        active: true,
      },
      {
        slug: "scale",
        name: "Scale",
        price_monthly: 149,
        price_monthly_inr: 11999,
        credits: 250,
        blurb: "For teams and agencies",
        features: [
          "250 video credits / month",
          "4K + vertical exports",
          "Team seats",
          "API access",
          "Custom integrations",
          "Dedicated manager",
        ],
        highlighted: false,
        sort_order: 3,
        active: true,
      },
    ].map((p) => ({
      id: randomUUID(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...p,
    })),
  );
}

// Install static seeds at startup (reset() also reinstalls them).
seedStatic();

/* ------------------------------------------------------------------ */
/* JWT (unsigned HS256 — supabase-js getClaims falls back to /auth/v1/user
 * for symmetric algs and trusts the decoded payload on success)        */
/* ------------------------------------------------------------------ */

const b64url = (obj) =>
  Buffer.from(JSON.stringify(obj)).toString("base64url");

function mintToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: "HS256", typ: "JWT" });
  const payload = b64url({
    sub: user.id,
    email: user.email,
    role: "authenticated",
    is_anonymous: false,
    iat: now,
    exp: now + 3600,
  });
  // Deliberately unsigned: this stub never verifies signatures, and
  // supabase-js getClaims() does not verify HS* tokens either — it calls
  // GET /auth/v1/user and trusts the payload when that succeeds.
  return `${header}.${payload}.stub`;
}

function userFromBearer(req) {
  const h = req.headers["authorization"] ?? "";
  const m = /^Bearer (.+)$/.exec(h);
  if (!m) return null;
  const userId = sessions.get(m[1]);
  if (!userId) return null;
  return [...users.values()].find((u) => u.id === userId) ?? null;
}

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    user_metadata: u.user_metadata ?? {},
    app_metadata: { provider: "email", providers: ["email"] },
    aud: "authenticated",
    role: "authenticated",
    created_at: u.created_at,
    confirmed_at: u.created_at,
    email_confirmed_at: u.created_at,
    is_anonymous: false,
  };
}

function newSession(user) {
  const access_token = mintToken(user);
  const refresh_token = `stub-refresh-${randomUUID()}`;
  sessions.set(access_token, user.id);
  sessions.set(refresh_token, user.id);
  return {
    access_token,
    refresh_token,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: publicUser(user),
  };
}

/** Deterministic signup side-effect: mirror the production
 * `handle_new_user` trigger — every user gets a profiles row with the
 * standard 50 free signup credits. */
function ensureProfile(user) {
  const rows = table("profiles");
  if (!rows.some((r) => r.id === user.id)) {
    rows.push({
      id: user.id,
      email: user.email,
      credits: 50,
      status: "active",
      created_at: new Date().toISOString(),
    });
    table("credit_ledger").push({
      id: randomUUID(),
      user_id: user.id,
      delta: 50,
      reason: "free signup grant",
      ref_id: null,
      created_at: new Date().toISOString(),
    });
  }
}

/* ------------------------------------------------------------------ */
/* PostgREST-ish query engine                                          */
/* ------------------------------------------------------------------ */

function parseValue(raw) {
  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
}

function splitOp(raw) {
  // "not.in.(a,b)" -> { negate: true, op: "in", arg: "(a,b)" }
  let negate = false;
  let rest = raw;
  if (rest.startsWith("not.")) {
    negate = true;
    rest = rest.slice(4);
  }
  const dot = rest.indexOf(".");
  if (dot === -1) return { negate, op: rest, arg: "" };
  return { negate, op: rest.slice(0, dot), arg: rest.slice(dot + 1) };
}

function compare(rowVal, op, arg) {
  const v = parseValue(arg);
  switch (op) {
    case "eq":
      return rowVal === v || String(rowVal) === String(v) || (rowVal == null && v == null && arg === "null");
    case "neq":
      return !(rowVal === v || String(rowVal) === String(v));
    case "lt":
      return rowVal < v;
    case "lte":
      return rowVal <= v;
    case "gt":
      return rowVal > v;
    case "gte":
      return rowVal >= v;
    case "in": {
      const list = arg.replace(/^\(|\)$/g, "").split(",");
      return list.some((x) => String(rowVal) === x);
    }
    case "is":
      return arg === "null" ? rowVal == null : String(rowVal) === arg;
    case "like":
    case "ilike": {
      const re = new RegExp(
        `^${arg.replace(/[%]/g, ".*").replace(/[_]/g, ".")}$`,
        op === "ilike" ? "i" : "",
      );
      return re.test(String(rowVal ?? ""));
    }
    default:
      return true; // unknown operator: don't filter (deterministic leniency)
  }
}

/** Minimal `X!inner(c1,c2)` embedded join: attaches row[X] by looking up
 * table X on row[<singular(X)>_id]. Covers script_versions -> scripts. */
function applyEmbedded(row, select) {
  const out = { ...row };
  const re = /(\w+)!inner\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(select)) !== null) {
    const [, refTable, cols] = m;
    const singular = refTable.replace(/s$/, "");
    const fk = row[`${singular}_id`];
    const found = table(refTable).find((r) => String(r.id) === String(fk));
    const picked = {};
    for (const c of cols.split(",").map((s) => s.trim()).filter(Boolean)) {
      picked[c] = found?.[c] ?? null;
    }
    out[refTable] = found ? picked : null;
  }
  return out;
}

function projectColumns(row, select) {
  if (!select || select === "*") return applyEmbedded(row, select ?? "");
  const cols = select.split(",").map((s) => s.trim()).filter(Boolean);
  const embedded = cols.filter((c) => c.includes("!inner"));
  const plain = cols.filter((c) => !c.includes("!inner") && !c.includes("("));
  const out = {};
  if (plain.length === 0 && embedded.length > 0) {
    // select was ONLY embedded resources: still include the row's own id
    // so callers can key on it (deterministic, documented).
    out.id = row.id;
  }
  for (const c of plain) out[c] = row[c] ?? null;
  if (embedded.length > 0) Object.assign(out, applyEmbedded(row, select));
  return out;
}

function applyQuery(rows, searchParams, select) {
  let out = rows.slice();
  // Filters (skip reserved params)
  const reserved = new Set(["select", "order", "limit", "offset"]);
  for (const [key, rawVal] of searchParams) {
    if (reserved.has(key)) continue;
    const val = decodeURIComponent(rawVal);
    const { negate, op, arg } = splitOp(val);
    out = out.filter((r) => {
      // Dotted keys like `research_sources.project_id` only occur with
      // embedded joins, which this stub does not filter on — skip them.
      if (key.includes(".")) return true;
      const hit = compare(r[key], op, decodeURIComponent(arg));
      return negate ? !hit : hit;
    });
  }
  const total = out.length;
  for (const ord of searchParams.getAll("order")) {
    const [col, dir] = decodeURIComponent(ord).split(".");
    out.sort((a, b) => {
      const av = a[col];
      const bv = b[col];
      if (av === bv) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = String(av) < String(bv) ? -1 : 1;
      return dir === "desc" ? -cmp : cmp;
    });
  }
  const offset = Number(searchParams.get("offset") ?? 0) || 0;
  const limitRaw = searchParams.get("limit");
  const limit = limitRaw == null ? null : Number(limitRaw);
  out = out.slice(offset, limit == null ? undefined : offset + limit);
  return { rows: out.map((r) => projectColumns(r, select)), total };
}

/* ------------------------------------------------------------------ */
/* HTTP helpers                                                        */
/* ------------------------------------------------------------------ */

function send(res, status, body, extraHeaders = {}) {
  const payload =
    body === undefined || body === null
      ? ""
      : typeof body === "string"
        ? body
        : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    // Real Supabase is CORS-open; the browser page (served from :3100)
    // calls the stub (:54321) cross-origin.
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, apikey, x-client-info",
    "x-vidora-e2e-stub": "deterministic-supabase-stub",
    ...extraHeaders,
  });
  res.end(payload);
}

const pgError = (message, code = "PGRST_STUB") => ({ code, message, details: "", hint: "" });

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

/* ------------------------------------------------------------------ */
/* Credit RPCs — same semantics as supabase/migrations                 */
/* ------------------------------------------------------------------ */

function getProfile(userId) {
  return table("profiles").find((r) => String(r.id) === String(userId));
}

function ledgerInsert({ user_id, delta, reason, ref_id }) {
  const row = {
    id: randomUUID(),
    user_id,
    delta,
    reason,
    ref_id: ref_id ?? null,
    created_at: new Date().toISOString(),
  };
  table("credit_ledger").push(row);
  return row;
}

function rpcError(res, message) {
  return send(res, 400, pgError(message, "P0001"));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function rpcDebitMinutesForJob(args, res) {
  const { p_user_id, p_minutes, p_reason, p_ref_id } = args;
  if (p_minutes == null || p_minutes < 1) return rpcError(res, "INVALID_MINUTES");
  const profile = getProfile(p_user_id);
  if (!profile) return rpcError(res, "PROFILE_NOT_FOUND");
  if (
    p_ref_id != null &&
    table("credit_ledger").some(
      (r) => String(r.user_id) === String(p_user_id) && String(r.ref_id) === String(p_ref_id) && r.delta < 0,
    )
  ) {
    return send(res, 200, profile.credits);
  }
  if (profile.credits < p_minutes) return rpcError(res, "INSUFFICIENT_CREDITS");
  profile.credits -= p_minutes;
  ledgerInsert({ user_id: p_user_id, delta: -p_minutes, reason: p_reason, ref_id: p_ref_id });
  return send(res, 200, profile.credits);
}

function rpcRefundMinutesForJob(args, res) {
  const { p_user_id, p_minutes, p_reason, p_ref_id } = args;
  if (p_minutes == null || p_minutes < 1) return rpcError(res, "INVALID_MINUTES");
  const profile = getProfile(p_user_id);
  if (!profile) return rpcError(res, "PROFILE_NOT_FOUND");
  if (
    p_ref_id != null &&
    table("credit_ledger").some(
      (r) => String(r.user_id) === String(p_user_id) && String(r.ref_id) === String(p_ref_id) && r.delta > 0,
    )
  ) {
    return send(res, 200, profile.credits);
  }
  profile.credits += p_minutes;
  ledgerInsert({ user_id: p_user_id, delta: p_minutes, reason: p_reason, ref_id: p_ref_id });
  return send(res, 200, profile.credits);
}

function rpcDebitJobOnce(args, res) {
  // Tolerate the legacy misnamed call shape from publish.functions.ts
  // ({ p_user_id, p_job_id: <reason string>, p_amount: 1 }).
  const p_user_id = args.p_user_id;
  const rawRef = args.p_job_id;
  const reason =
    args.p_reason ?? (typeof rawRef === "string" && !UUID_RE.test(rawRef) ? rawRef : "debit");
  const p_ref_id = typeof rawRef === "string" && UUID_RE.test(rawRef) ? rawRef : null;
  const profile = getProfile(p_user_id);
  if (!profile) return rpcError(res, "PROFILE_NOT_FOUND");
  if (
    p_ref_id != null &&
    table("credit_ledger").some(
      (r) => String(r.user_id) === String(p_user_id) && String(r.ref_id) === String(p_ref_id) && r.delta < 0,
    )
  ) {
    return send(res, 200, profile.credits);
  }
  if (profile.credits < 1) return rpcError(res, "INSUFFICIENT_CREDITS");
  profile.credits -= 1;
  ledgerInsert({ user_id: p_user_id, delta: -1, reason, ref_id: p_ref_id });
  return send(res, 200, profile.credits);
}

function rpcAdjustCredits(args, res) {
  const { p_user_id, p_delta, p_reason } = args;
  const profile = getProfile(p_user_id);
  if (!profile) return rpcError(res, "PROFILE_NOT_FOUND");
  profile.credits += p_delta;
  ledgerInsert({ user_id: p_user_id, delta: p_delta, reason: p_reason ?? "adjust", ref_id: null });
  return send(res, 200, profile.credits);
}

function rpcGrantCreditsOnce(args, res) {
  const { p_user_id, p_amount, p_reason, p_ref_id } = args;
  if (p_amount == null || p_amount <= 0) return rpcError(res, "INVALID_AMOUNT");
  const profile = getProfile(p_user_id);
  if (!profile) return rpcError(res, "PROFILE_NOT_FOUND");
  if (
    p_ref_id != null &&
    table("credit_ledger").some(
      (r) => String(r.user_id) === String(p_user_id) && String(r.ref_id) === String(p_ref_id) && r.delta > 0,
    )
  ) {
    return send(res, 200, profile.credits);
  }
  profile.credits += p_amount;
  ledgerInsert({ user_id: p_user_id, delta: p_amount, reason: p_reason, ref_id: p_ref_id });
  return send(res, 200, profile.credits);
}

function rpcDispatcher(fn, args, res) {
  switch (fn) {
    case "debit_credits_for_minutes":
      return rpcDebitMinutesForJob(args, res);
    case "refund_credits_for_minutes":
      return rpcRefundMinutesForJob(args, res);
    case "debit_credits_for_job_once":
      return rpcDebitJobOnce(args, res);
    case "adjust_credits":
      return rpcAdjustCredits(args, res);
    case "grant_credits_once":
      return rpcGrantCreditsOnce(args, res);
    case "check_rate_limit":
      // Deterministic e2e: no rate limiting.
      return send(res, 200, true);
    case "log_abuse_signal":
      table("abuse_signals").push({ id: randomUUID(), ...(args ?? {}), created_at: new Date().toISOString() });
      return send(res, 200, 0);
    default:
      return send(res, 404, pgError(`stub: unknown RPC ${fn}`, "PGRST202"));
  }
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

async function handler(req, res) {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const { pathname, searchParams } = url;

  try {
    /* ---- CORS preflight (real Supabase answers these) ---- */
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
        "access-control-allow-headers":
          req.headers["access-control-request-headers"] ??
          "authorization, content-type, apikey, x-client-info",
        "access-control-max-age": "86400",
        "x-vidora-e2e-stub": "deterministic-supabase-stub",
      });
      return res.end();
    }

    /* ---- test-only helpers (clearly namespaced, never in prod) ---- */
    if (pathname === "/e2e/reset" && req.method === "POST") {
      reset();
      return send(res, 200, { ok: true });
    }
    if (pathname === "/e2e/users" && req.method === "GET") {
      const email = searchParams.get("email");
      const list = [...users.values()].filter((u) => !email || u.email === email.replace(/^eq\./, ""));
      return send(res, 200, list.map(publicUser));
    }

    /* ---- auth ---- */
    if (pathname === "/auth/v1/signup" && req.method === "POST") {
      const body = (await readBody(req)) ?? {};
      const email = String(body.email ?? "").toLowerCase();
      const password = String(body.password ?? "");
      if (!email || !password) return send(res, 400, { error: "validation_failed", error_description: "email and password required" });
      if (users.has(email)) return send(res, 400, { error: "user_exists", error_description: "User already registered" });
      const user = {
        id: randomUUID(),
        email,
        password,
        user_metadata: body.data ?? {},
        created_at: new Date().toISOString(),
      };
      users.set(email, user);
      ensureProfile(user);
      // Real GoTrue shape: session fields at the TOP level (auth-js
      // hasSession() requires data.access_token/refresh_token/expires_in).
      return send(res, 200, newSession(user));
    }

    if (pathname === "/auth/v1/token" && req.method === "POST") {
      const grant = searchParams.get("grant_type");
      const body = (await readBody(req)) ?? {};
      if (grant === "password") {
        const email = String(body.email ?? "").toLowerCase();
        const user = users.get(email);
        if (!user || user.password !== String(body.password ?? "")) {
          return send(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials" });
        }
        // Real GoTrue shape: session fields at the top level.
        return send(res, 200, newSession(user));
      }
      if (grant === "refresh_token") {
        const userId = sessions.get(body.refresh_token);
        const user = [...users.values()].find((u) => u.id === userId);
        if (!user) return send(res, 400, { error: "invalid_grant", error_description: "Invalid refresh token" });
        // Real GoTrue shape: session fields at the top level.
        return send(res, 200, newSession(user));
      }
      return send(res, 400, { error: "unsupported_grant_type" });
    }

    if (pathname === "/auth/v1/user" && req.method === "GET") {
      const user = userFromBearer(req);
      if (!user) return send(res, 401, { error: "unauthorized", error_description: "invalid token" });
      return send(res, 200, publicUser(user));
    }

    if (pathname === "/auth/v1/user" && req.method === "PUT") {
      const user = userFromBearer(req);
      if (!user) return send(res, 401, { error: "unauthorized" });
      const body = (await readBody(req)) ?? {};
      if (body.data) user.user_metadata = { ...user.user_metadata, ...body.data };
      if (body.email) {
        users.delete(user.email);
        user.email = String(body.email).toLowerCase();
        users.set(user.email, user);
      }
      return send(res, 200, { user: publicUser(user) });
    }

    if (pathname === "/auth/v1/logout" && req.method === "POST") {
      const h = req.headers["authorization"] ?? "";
      const m = /^Bearer (.+)$/.exec(h);
      if (m) sessions.delete(m[1]);
      res.writeHead(204, { "x-vidora-e2e-stub": "deterministic-supabase-stub" });
      return res.end();
    }

    /* ---- RPC ---- */
    const rpcMatch = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(pathname);
    if (rpcMatch && req.method === "POST") {
      const body = (await readBody(req)) ?? {};
      return rpcDispatcher(rpcMatch[1], body, res);
    }

    /* ---- REST tables ---- */
    const tblMatch = /^\/rest\/v1\/([a-z0-9_]+)$/.exec(pathname);
    if (tblMatch) {
      const name = tblMatch[1];
      const rows = table(name);
      const select = searchParams.get("select") ?? "*";
      const accept = req.headers["accept"] ?? "";
      const wantSingle = accept.includes("application/vnd.pgrst.object+json");
      const prefer = req.headers["prefer"] ?? "";
      const countRequested = /count=(exact|planned|estimated)/.test(prefer);

      if (req.method === "GET") {
        const { rows: out, total } = applyQuery(rows, searchParams, select);
        const headers = {};
        if (countRequested) headers["content-range"] = `*/${total}`;
        if (wantSingle) {
          if (out.length !== 1) {
            return send(res, 406, pgError("JSON object requested, multiple (or no) rows returned", "PGRST116"));
          }
          return send(res, 200, out[0], headers);
        }
        return send(res, 200, out, headers);
      }

      if (req.method === "POST") {
        const body = await readBody(req);
        // Column defaults mirrored from supabase/migrations (PostgREST would
        // apply these server-side; the stub must too or the app reads
        // undefined for e.g. scripts.status and crashes on STATUS_COPY[...]).
        const defaults = COLUMN_DEFAULTS[name] ?? {};
        const items = (Array.isArray(body) ? body : [body ?? {}]).map((item) => ({
          id: randomUUID(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          // fresh copies so rows never share a default object/array
          ...structuredClone(defaults),
          ...item,
        }));
        rows.push(...items);
        const { rows: out } = applyQuery(items, new URLSearchParams(), select);
        if (wantSingle) {
          if (out.length !== 1) return send(res, 406, pgError("JSON object requested, multiple (or no) rows returned", "PGRST116"));
          return send(res, 201, out[0]);
        }
        return send(res, 201, out);
      }

      if (req.method === "PATCH" || req.method === "PUT") {
        const body = (await readBody(req)) ?? {};
        const { rows: matched } = applyQuery(rows, searchParams, "*");
        const updated = [];
        for (const mrow of matched) {
          const live = rows.find((r) => r === mrow || r.id === mrow.id);
          if (live) {
            Object.assign(live, body, { updated_at: new Date().toISOString() });
            updated.push(live);
          }
        }
        const { rows: out } = applyQuery(updated, new URLSearchParams(), select);
        if (wantSingle) {
          if (out.length !== 1) return send(res, 406, pgError("JSON object requested, multiple (or no) rows returned", "PGRST116"));
          return send(res, 200, out[0]);
        }
        return send(res, 200, out);
      }

      if (req.method === "DELETE") {
        const { rows: matched } = applyQuery(rows, searchParams, "*");
        const ids = new Set(matched.map((r) => r.id));
        const kept = rows.filter((r) => !ids.has(r.id));
        tables.set(name, kept);
        return send(res, 200, []);
      }

      return send(res, 405, pgError("method not allowed"));
    }

    return send(res, 404, pgError(`stub: no route ${req.method} ${pathname}`, "PGRST_STUB_404"));
  } catch (e) {
    return send(res, 500, pgError(e instanceof Error ? e.message : String(e), "PGRST_STUB_500"));
  }
}

const server = createServer(handler);
server.listen(PORT, HOST, () => {
  console.log(`[e2e-stub] deterministic Supabase stub on http://${HOST}:${PORT}`);
});
