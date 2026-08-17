import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/youtube-callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const oauthError = url.searchParams.get("error");

        const back = (params: string) =>
          new Response(null, { status: 302, headers: { Location: `/studio?${params}` } });

        if (oauthError) return back(`youtube=error&reason=${encodeURIComponent(oauthError)}`);
        if (!code || !state) return back("youtube=error&reason=missing_code");

        const { verifyState, exchangeCode, fetchChannel } = await import("@/lib/youtube.server");
        const userId = await verifyState(state);
        if (!userId) return back("youtube=error&reason=invalid_state");

        try {
          const tokens = await exchangeCode(code, url.origin);
          if (!tokens.refresh_token) {
            return back("youtube=error&reason=no_refresh_token");
          }
          const channel = await fetchChannel(tokens.access_token ?? "");

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error } = await supabaseAdmin.from("youtube_connections").upsert(
            {
              user_id: userId,
              refresh_token: tokens.refresh_token,
              access_token: tokens.access_token ?? null,
              expires_at: new Date(Date.now() + (tokens.expires_in ?? 3500) * 1000).toISOString(),
              scope: tokens.scope ?? null,
              channel_id: channel.id,
              channel_title: channel.title,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          );
          if (error) throw new Error(error.message);

          return back("youtube=connected");
        } catch (error) {
          const message = error instanceof Error ? error.message : "connect_failed";
          return back(`youtube=error&reason=${encodeURIComponent(message)}`);
        }
      },
    },
  },
});
