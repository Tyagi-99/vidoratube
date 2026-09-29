import { createServerFn } from "@tanstack/react-start";

export type CheckStatus = "ok" | "degraded" | "down" | "not_configured";

export type StatusCheck = {
  name: string;
  status: CheckStatus;
  latencyMs: number | null;
  detail: string;
};

export type SystemStatus = {
  checks: StatusCheck[];
  at: string;
};

const TIMEOUT_MS = 5000;

function timeoutSignal(): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

async function check(
  name: string,
  run: () => Promise<string>,
): Promise<StatusCheck> {
  const started = Date.now();
  try {
    const detail = await run();
    const latencyMs = Date.now() - started;
    return {
      name,
      status: latencyMs > 3000 ? "degraded" : "ok",
      latencyMs,
      detail,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed";
    const classified = classifyCheckError(message);
    return {
      name,
      status: classified.status,
      latencyMs: classified.status === "not_configured" ? null : Date.now() - started,
      detail: classified.detail,
    };
  }
}

/**
 * Maps a thrown check error to a status. Prefix conventions:
 * - "not_configured:…" → the dependency is not set up (no latency).
 * - "degraded:…" → reachable but unhealthy/misleading (e.g. a restricted
 *   ElevenLabs key that 401s on /v1/user yet can still synthesize).
 * - anything else → down.
 */
export function classifyCheckError(message: string): {
  status: CheckStatus;
  detail: string;
} {
  if (message.startsWith("not_configured:")) {
    return { status: "not_configured", detail: message.slice("not_configured:".length) };
  }
  if (message.startsWith("degraded:")) {
    return { status: "degraded", detail: message.slice("degraded:".length) };
  }
  return { status: "down", detail: message };
}

/**
 * Probes the ElevenLabs account endpoint. A 401 does NOT mean TTS is down:
 * restricted TTS-scoped keys return 401 on /v1/user yet can still synthesize
 * (voice previews only enter the playing state after real synthesis), so it is
 * reported as degraded with guidance instead of down.
 */
export async function probeElevenLabsUser(key: string, signal: AbortSignal): Promise<string> {
  const res = await fetch("https://api.elevenlabs.io/v1/user", {
    headers: { "xi-api-key": key },
    signal,
  });
  if (res.status === 401)
    throw new Error(
      "degraded:account probe returned 401 — key is present but restricted or invalid. " +
        "Restricted TTS keys fail this /v1/user probe but can still synthesize; " +
        "run the paid TTS probe on /admin/readiness for the definitive check.",
    );
  if (!res.ok) throw new Error(`ElevenLabs returned ${res.status}`);
  return "ElevenLabs reachable";
}

/**
 * Public system status. Every check has a 5s timeout and runs in parallel;
 * nothing here costs provider credits (metadata endpoints only).
 */
export const getSystemStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<SystemStatus> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const checks = await Promise.all([
      check("Database", async () => {
        const { error, count } = await supabaseAdmin
          .from("profiles")
          .select("id", { count: "exact", head: true });
        if (error) throw new Error(error.message);
        return `reachable (${count ?? 0} profiles)`;
      }),
      check("Storage", async () => {
        const { error } = await supabaseAdmin.storage.from("generated-videos").list("", {
          limit: 1,
        });
        if (error) throw new Error(error.message);
        return "generated-videos bucket reachable";
      }),
      check("AI gateway", async () => {
        const key = process.env["LOVABLE_API_KEY"];
        if (!key) throw new Error("not_configured:LOVABLE_API_KEY is not set");
        const { signal, cancel } = timeoutSignal();
        try {
          // Models list is a free metadata call — no generation credits spent.
          const res = await fetch("https://ai.gateway.lovable.dev/v1/models", {
            headers: { Authorization: `Bearer ${key}` },
            signal,
          });
          if (!res.ok) throw new Error(`gateway returned ${res.status}`);
          return "gateway reachable";
        } finally {
          cancel();
        }
      }),
      check("ElevenLabs", async () => {
        const key = process.env["ELEVENLABS_API_KEY"];
        if (!key) throw new Error("not_configured:ELEVENLABS_API_KEY is not set");
        const { signal, cancel } = timeoutSignal();
        try {
          // /v1/user is a free account-info call — no synthesis credits spent.
          return await probeElevenLabsUser(key, signal);
        } finally {
          cancel();
        }
      }),
      renderWorkerCheck(),
    ]);

    return { checks, at: new Date().toISOString() };
  },
);

/**
 * "Render worker" check: reads the latest worker_heartbeats row through the
 * service role (authenticated clients have no RLS policy on that table —
 * worker infrastructure is not user data) plus the server-render queue
 * depth. Status follows the shared worker-health thresholds: ok when the
 * last beat is under 15 minutes old, degraded 15–60, down past 60 minutes
 * or when no heartbeat was ever recorded.
 */
async function renderWorkerCheck(): Promise<StatusCheck> {
  const started = Date.now();
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { workerHealthStatus, formatRelativeTime } = await import("./worker-health");
    const [beatRes, queuedRes, runningRes] = await Promise.all([
      supabaseAdmin
        .from("worker_heartbeats")
        .select("worker_id,last_seen_at")
        .order("last_seen_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("renders")
        .select("id", { count: "exact", head: true })
        .eq("engine", "server_ffmpeg")
        .eq("status", "queued"),
      supabaseAdmin
        .from("renders")
        .select("id", { count: "exact", head: true })
        .eq("engine", "server_ffmpeg")
        .eq("status", "running"),
    ]);
    if (beatRes.error) throw new Error(beatRes.error.message);
    if (queuedRes.error) throw new Error(queuedRes.error.message);
    if (runningRes.error) throw new Error(runningRes.error.message);

    const beat = beatRes.data;
    const status = workerHealthStatus(beat?.last_seen_at ?? null);
    const queue = `${queuedRes.count ?? 0} queued, ${runningRes.count ?? 0} running`;
    const detail = beat?.last_seen_at
      ? `last beat ${formatRelativeTime(beat.last_seen_at)} · worker ${beat.worker_id} · ${queue}`
      : `no heartbeat recorded yet · ${queue}`;
    return { name: "Render worker", status, latencyMs: Date.now() - started, detail };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed";
    return { name: "Render worker", status: "down", latencyMs: Date.now() - started, detail: message };
  }
}
