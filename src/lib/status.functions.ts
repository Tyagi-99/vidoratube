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
    if (message.startsWith("not_configured:")) {
      return { name, status: "not_configured", latencyMs: null, detail: message.slice(15) };
    }
    return { name, status: "down", latencyMs: Date.now() - started, detail: message };
  }
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
          // /v2/user is a free account-info call — no synthesis credits spent.
          const res = await fetch("https://api.elevenlabs.io/v2/user", {
            headers: { "xi-api-key": key },
            signal,
          });
          if (!res.ok) throw new Error(`ElevenLabs returned ${res.status}`);
          return "ElevenLabs reachable";
        } finally {
          cancel();
        }
      }),
    ]);

    return { checks, at: new Date().toISOString() };
  },
);
