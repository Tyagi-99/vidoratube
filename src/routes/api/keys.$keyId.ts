import { createFileRoute } from "@tanstack/react-router";
import { revokeApiKey } from "@/lib/api-keys/keys.server";
import { auditKeyAction, requireAdminKey } from "@/lib/api-keys/rest.server";

/** DELETE /api/keys/:keyId — revoke a key (admin:keys scope). */
export const Route = createFileRoute("/api/keys/$keyId")({
  server: {
    handlers: {
      DELETE: async ({ request, params }) => {
        const gate = await requireAdminKey(request);
        if ("response" in gate) return gate.response;
        const keyId = params.keyId;
        try {
          await revokeApiKey(keyId, gate.key.workspaceId);
          await auditKeyAction(gate.key, "api.keys.revoked", keyId);
          return Response.json({ ok: true, revoked: keyId });
        } catch (e) {
          return Response.json(
            { error: e instanceof Error ? e.message : "could not revoke API key" },
            { status: 400 },
          );
        }
      },
    },
  },
});
