import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // TEMPORARY: login disabled — visitors are silently signed in as guests.
    // To re-enable login: remove the signInAnonymously fallback and
    // restore `if (error || !data.user) throw redirect({ to: "/auth" });`
    let { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      const { error: anonError } = await supabase.auth.signInAnonymously();
      if (!anonError) {
        ({ data, error } = await supabase.auth.getUser());
      }
    }
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: () => <Outlet />,
});
