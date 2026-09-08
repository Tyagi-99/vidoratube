// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Lovable Cloud always binds the server-side names. Mirror only the public
// connection values into Vite's browser bundle when a deployment does not
// provide their VITE_* aliases. The service-role key is intentionally never
// exposed here.
const managedCloudUrl = "https://paowbdzcrncsiyogwnys.supabase.co";
const managedCloudPublishableKey = "sb_publishable_cpm_1zLpkcOfkUtdYfdVfw_9GrEtfhg";

const supabaseUrl =
  process.env["VITE_SUPABASE_URL"] ?? process.env["SUPABASE_URL"] ?? managedCloudUrl;
const supabasePublishableKey =
  process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ??
  process.env["SUPABASE_PUBLISHABLE_KEY"] ??
  managedCloudPublishableKey;

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
