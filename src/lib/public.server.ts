import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** Publishable-key Supabase client for public, RLS-gated reads on the server. */
export function createPublicSupabase() {
  // Prefer runtime server env; fall back to the build-time baked-in values.
  // vite.config.ts defines import.meta.env.VITE_SUPABASE_* for every bundle
  // (client AND server), so environments that don't inject SUPABASE_URL into
  // the server runtime — like the Lovable preview dev-server — keep working
  // instead of crashing with "supabaseUrl is required".
  const url =
    process.env["SUPABASE_URL"] ?? import.meta.env["VITE_SUPABASE_URL"];
  const key =
    process.env["SUPABASE_PUBLISHABLE_KEY"] ??
    import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];

  if (!url || !key) {
    throw new Error(
      "[vidora] Supabase URL/publishable key not configured. Set SUPABASE_URL and " +
        "SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY at build time).",
    );
  }

  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
}
