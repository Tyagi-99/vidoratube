// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// SECURITY: these are the production project's *publishable* values, used ONLY as
// a build-time fallback so the Lovable-hosted deployment keeps working when the
// build environment does not provide them. They are public by design (the key
// ships in every client bundle), but any non-Lovable build that reaches this
// fallback is almost certainly misconfigured — the client throws a clear error
// at startup in that case (see src/integrations/supabase/client.ts) instead of
// silently reading/writing the production database.
const managedCloudUrl = "https://paowbdzcrncsiyogwnys.supabase.co";
const managedCloudPublishableKey = "sb_publishable_cpm_1zLpkcOfkUtdYfdVfw_9GrEtfhg";

const supabaseUrl =
  process.env["VITE_SUPABASE_URL"] ?? process.env["SUPABASE_URL"] ?? managedCloudUrl;
const supabasePublishableKey =
  process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ??
  process.env["SUPABASE_PUBLISHABLE_KEY"] ??
  managedCloudPublishableKey;

if (supabaseUrl === managedCloudUrl) {
  console.warn(
    "[vidora] No VITE_SUPABASE_URL/SUPABASE_URL at build time — baking in the production " +
      "Supabase project. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to target " +
      "your own project.",
  );
}

export default defineConfig({
  vite: {
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(supabaseUrl),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(supabasePublishableKey),
    },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
