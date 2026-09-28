#!/usr/bin/env node
/**
 * E2E server launcher for `npm run test:e2e` (Phase 6, Stream A).
 *
 * Starts, in order:
 *   1. The deterministic Supabase stub  (e2e/stub-supabase/server.mjs) on
 *      127.0.0.1:54321 — in-memory auth + PostgREST + credit RPCs. No real
 *      Supabase, no provider keys, no money.
 *   2. The PRODUCTION build's node server (.output/server/index.mjs) on
 *      127.0.0.1:3101 (internal) with VIDORA_E2E_ADAPTER=deterministic, so
 *      script generation uses the deterministic adapter instead of the
 *      Lovable AI gateway.
 *   3. A same-origin E2E gateway on 127.0.0.1:3100. The browser can only
 *      reach the app through the Playwright loopback bridge, and Chromium's
 *      Local Network Access checks silently drop cross-origin POST/OPTIONS
 *      from the page to the stub port before Playwright routing ever sees
 *      them. To keep ALL browser traffic same-origin, the production build
 *      is compiled with
 *        VITE_SUPABASE_URL=http://127.0.0.1:3100/__e2e/supabase
 *      and the gateway forwards:
 *        /__e2e/supabase/*  ->  127.0.0.1:54321/*   (deterministic stub)
 *        everything else    ->  127.0.0.1:3101/*   (production app)
 *
 * This preserves the real app, the real server, and the real stub: only
 * the transport is adapted, and every API call the browser makes is still
 * answered by the deterministic stub. Server-side Supabase traffic keeps
 * using SUPABASE_URL=http://127.0.0.1:54321 directly.
 *
 * Used as the Playwright `webServer.command`. Stays alive until Playwright
 * kills it. Exits non-zero if either child fails to become healthy.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const STUB_PORT = Number(process.env.E2E_STUB_PORT ?? 54321);
const INTERNAL_APP_PORT = Number(process.env.E2E_INTERNAL_APP_PORT ?? 3101);
const GATEWAY_PORT = Number(process.env.E2E_APP_PORT ?? 3100);
const SUPABASE_PREFIX = "/__e2e/supabase";
const STUB_URL = `http://127.0.0.1:${STUB_PORT}`;
const APP_URL = `http://127.0.0.1:${INTERNAL_APP_PORT}`;
const GATEWAY_URL = `http://127.0.0.1:${GATEWAY_PORT}`;

const serverEntry = join(root, ".output", "server", "index.mjs");
if (!existsSync(serverEntry)) {
  console.error(
    `[e2e-serve] Production build not found at ${serverEntry}.\n` +
      `Run \`npm run build:e2e\` first (it is part of \`npm run test:e2e\`).`,
  );
  process.exit(1);
}

function waitFor(url, timeoutMs, label) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url);
        // Any HTTP response (even 404/500) means the server is up.
        if (res.status) return resolve();
      } catch {
        /* not up yet */
      }
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`${label} did not become healthy at ${url}`));
      }
      setTimeout(tick, 500);
    };
    tick();
  });
}

const children = [];
function launch(name, cmd, args, env, cwd) {
  const child = spawn(cmd, args, { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => process.stdout.write(`[${name}] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[${name}] ${d}`));
  child.on("exit", (code, signal) => {
    console.error(`[e2e-serve] ${name} exited (code=${code}, signal=${signal})`);
    shutdown(code === 0 ? 0 : 1);
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    gateway.close();
  } catch {
    /* not started */
  }
  for (const c of children) {
    try {
      c.kill("SIGTERM");
    } catch {
      /* already dead */
    }
  }
  setTimeout(() => process.exit(code), 500).unref();
}
process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));

/**
 * Same-origin gateway. Forwards one request to (host, port, path),
 * streaming the body and response. Pure transport: no request is
 * rewritten, created, or faked — the stub and the app answer exactly as
 * they would over a direct connection.
 *
 * The Host header is preserved as the public gateway host (127.0.0.1:3100)
 * when forwarding to the internal app, because the app's CSRF middleware
 * compares the Origin header against the request URL's origin (built from
 * Host). Node's fetch strips Sec-Fetch-Site, so the Origin check is the
 * one that runs — and it must see 127.0.0.1:3100, not the internal :3101.
 */
function forward(creq, cres, targetPort, targetPath, publicHost) {
  const headers = { ...creq.headers };
  delete headers["connection"];
  headers["host"] = publicHost;
  const preq = httpRequest(
    {
      host: "127.0.0.1",
      port: targetPort,
      path: targetPath,
      method: creq.method,
      headers,
    },
    (pres) => {
      const outHeaders = { ...pres.headers };
      delete outHeaders["transfer-encoding"];
      cres.writeHead(pres.statusCode ?? 502, outHeaders);
      pres.pipe(cres);
    },
  );
  preq.on("error", (e) => {
    if (!cres.headersSent) cres.writeHead(502, { "content-type": "text/plain" });
    cres.end(`e2e gateway: upstream unreachable (${e.message})`);
  });
  creq.pipe(preq);
}

const gateway = createServer((creq, cres) => {
  const rawPath = creq.url ?? "/";
  if (rawPath === SUPABASE_PREFIX || rawPath.startsWith(`${SUPABASE_PREFIX}/`)) {
    const stubPath = rawPath.slice(SUPABASE_PREFIX.length) || "/";
    forward(creq, cres, STUB_PORT, stubPath, `127.0.0.1:${GATEWAY_PORT}`);
  } else {
    forward(creq, cres, INTERNAL_APP_PORT, rawPath, `127.0.0.1:${GATEWAY_PORT}`);
  }
});

// WebSocket upgrades (e.g. Supabase realtime) go to the stub as well. The
// deterministic stub does not implement the realtime protocol; the client
// retries with backoff, which is fine for the E2E flows under test.
gateway.on("upgrade", (creq, socket) => {
  const rawPath = creq.url ?? "/";
  const targetPort = rawPath.startsWith(SUPABASE_PREFIX) ? STUB_PORT : INTERNAL_APP_PORT;
  const targetPath = rawPath.startsWith(SUPABASE_PREFIX)
    ? rawPath.slice(SUPABASE_PREFIX.length) || "/"
    : rawPath;
  const headers = { ...creq.headers };
  delete headers["connection"];
  headers["host"] = `127.0.0.1:${GATEWAY_PORT}`;
  const preq = httpRequest({
    host: "127.0.0.1",
    port: targetPort,
    path: targetPath,
    method: creq.method,
    headers,
  });
  preq.on("upgrade", (pres, psocket) => {
    socket.write(
      `HTTP/${pres.httpVersion} ${pres.statusCode} ${pres.statusMessage}\r\n`,
    );
    for (const [k, v] of Object.entries(pres.headers)) {
      if (v !== undefined) socket.write(`${k}: ${Array.isArray(v) ? v.join(", ") : v}\r\n`);
    }
    socket.write("\r\n");
    psocket.pipe(socket);
    socket.pipe(psocket);
  });
  preq.on("error", () => socket.destroy());
  preq.end();
});

const baseEnv = { ...process.env };

launch("stub", process.execPath, [join(root, "e2e", "stub-supabase", "server.mjs")], {
  ...baseEnv,
  E2E_STUB_PORT: String(STUB_PORT),
});

launch("app", process.execPath, [serverEntry], {
  ...baseEnv,
  PORT: String(INTERNAL_APP_PORT),
  // Server-side Supabase config points at the stub (service role is
  // accepted verbatim by the stub — it is test-only).
  SUPABASE_URL: STUB_URL,
  SUPABASE_PUBLISHABLE_KEY: "e2e-test-publishable-key",
  SUPABASE_SERVICE_ROLE_KEY: "e2e-test-service-key",
  // Deterministic adapters: script generation (and any future provider
  // call) returns canned deterministic output instead of calling paid
  // provider APIs. Fail-closed: only active with this exact value.
  VIDORA_E2E_ADAPTER: "deterministic",
});

try {
  await waitFor(`${STUB_URL}/e2e/users`, 20_000, "stub");
  await waitFor(APP_URL, 60_000, "app");
  await new Promise((resolve, reject) => {
    gateway.once("error", reject);
    gateway.listen(GATEWAY_PORT, "127.0.0.1", () => resolve());
  });
  await waitFor(`${GATEWAY_URL}/__e2e/supabase/e2e/users`, 10_000, "gateway-supabase");
  await waitFor(GATEWAY_URL, 10_000, "gateway-app");
  console.log(`[e2e-serve] ready: stub=${STUB_URL} app=${APP_URL} gateway=${GATEWAY_URL}`);
} catch (e) {
  console.error(`[e2e-serve] ${e instanceof Error ? e.message : e}`);
  shutdown(1);
}
