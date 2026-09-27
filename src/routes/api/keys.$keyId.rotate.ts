import { createFileRoute } from "@tanstack/react-router";
import { rotateApiKey } from "@/lib/api-keys/keys.server";
import { auditKeyAction, requireAdminKey } from "@/lib/api-keys/rest.server";

/**
 * POST /api/keys/:keyId/rotate — rotate a key (admin:keys scope).
 * Creates a replacement (same name/scopes/rate-limit/expiry), then revokes
 * the old one. The new RAW key is returned ONCE in the response.
 */
export const Route = createFileRoute("/api/keys/$keyId/rotate")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const gate = await requireAdminKey(request);
        if ("response" in gate) return gate.response;
        if (!gate.key.createdBy) {
          return Response.json(
            { error: "this API key has no owning user and cannot rotate keys" },
            { status: 403 },
          );
        }
        try {
          const rotated = await rotateApiKey(
            params.keyId,
            gate.key.workspaceId,
            gate.key.createdBy,
          );
          await auditKeyAction(gate.key, "api.keys.rotated", rotated.meta.id, {
            old_key_id: params.keyId,
            name: rotated.meta.name,
          });
          // raw_key is surfaced HERE ONLY — never stored, never logged.
          return Response.json({ key: rotated.meta, raw_key: rotated.rawKey });
        } catch (e) {
          return Response.json(
            { error: e instanceof Error ? e.message : "could not rotate API key" },
            { status: 400 },
          );
        }
      },
    },
  },
});
