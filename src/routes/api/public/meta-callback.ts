import { createFileRoute } from "@tanstack/react-router";

/**
 * Sprint 7–8 (workstream A): Meta (Facebook Login) OAuth callback.
 *
 * Flow: verify signed state -> code exchange -> long-lived user token ->
 * /me/accounts -> find the founder-designated TEST Page -> verify the linked
 * IG account against META_TEST_IG_USER_ID -> store the encrypted Page token.
 *
 * Fail closed: when META_TEST_PAGE_ID is unset, or the user doesn't manage the
 * test Page, or the linked IG account isn't the test account, nothing is
 * stored and the user gets an explicit error reason.
 */
export const Route = createFileRoute("/api/public/meta-callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const oauthError = url.searchParams.get("error");

        const back = (params: string) =>
          new Response(null, { status: 302, headers: { Location: `/studio?${params}` } });

        if (oauthError) return back(`meta=error&reason=${encodeURIComponent(oauthError)}`);
        if (!code || !state) return back("meta=error&reason=missing_code");

        const {
          verifyMetaState,
          exchangeMetaCode,
          exchangeForLongLivedToken,
          getManagedPages,
          encryptMetaToken,
          META_CONNECT_SCOPES,
        } = await import("@/lib/meta-publish.server");
        const { assertMetaPublishingEnabled } = await import("@/lib/publishing-gates.server");

        const userId = await verifyMetaState(state);
        if (!userId) return back("meta=error&reason=invalid_state");

        // Test-account designation must exist BEFORE any token is stored.
        let testPageId: string;
        try {
          testPageId = assertMetaPublishingEnabled("facebook");
        } catch {
          return back("meta=error&reason=test_page_not_configured");
        }
        const testIgId = (() => {
          try {
            return assertMetaPublishingEnabled("instagram");
          } catch {
            return null;
          }
        })();

        try {
          const { accessToken: shortToken } = await exchangeMetaCode(code, url.origin);
          const { accessToken: longToken, expiresIn } =
            await exchangeForLongLivedToken(shortToken);
          const pages = await getManagedPages(longToken);
          const page = pages.find((p) => p.id === testPageId);
          if (!page) {
            return back("meta=error&reason=test_page_not_found");
          }
          const ig = page.instagram_business_account ?? null;
          if (testIgId && ig?.id !== testIgId) {
            return back("meta=error&reason=ig_account_mismatch");
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: stored, error } = await supabaseAdmin
            .from("meta_connections")
            .upsert(
              {
                user_id: userId,
                page_id: page.id,
                page_name: page.name,
                ig_user_id: ig?.id ?? null,
                ig_username: ig?.username ?? null,
                access_token: await encryptMetaToken(page.access_token),
                token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
                scope: META_CONNECT_SCOPES,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "user_id" },
            )
            .select("id")
            .single();
          if (error) throw new Error(error.message);

          // Phase 4, Stream A (F27): register the Page and (when linked) the
          // IG account in the channel_connections registry. Tokens stay in
          // meta_connections — only the row id is linked.
          const { registerChannelConnection } = await import("@/lib/publish/channels.server");
          const register = (input: {
            platform: "facebook" | "instagram";
            externalChannelId: string;
            displayName: string | null;
          }) =>
            registerChannelConnection(supabaseAdmin, {
              userId,
              platform: input.platform,
              externalChannelId: input.externalChannelId,
              displayName: input.displayName,
              metaConnectionId: stored?.id ?? null,
            }).catch((e) => {
              console.warn(
                "[vidora] channel registry write failed",
                e instanceof Error ? e.message : e,
              );
            });
          await register({ platform: "facebook", externalChannelId: page.id, displayName: page.name });
          if (ig?.id) {
            await register({
              platform: "instagram",
              externalChannelId: ig.id,
              displayName: ig.username ?? null,
            });
          }
          return back("meta=connected");
        } catch (error) {
          const message = error instanceof Error ? error.message : "connect_failed";
          return back(`meta=error&reason=${encodeURIComponent(message)}`);
        }
      },
    },
  },
});
