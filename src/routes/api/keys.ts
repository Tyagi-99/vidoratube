import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createApiKey, listApiKeys } from "@/lib/api-keys/keys.server";
import { rateLimitHeaders } from "@/lib/api-keys/keys";
import { auditKeyAction, requireAdminKey } from "@/lib/api-keys/rest.server";

/**
 * Phase 4 Stream E (F41) — programmatic API key management.
 *
 * GET  /api/keys — list key metadata (never hashes or raw keys).
 * POST /api/keys — create a key; the RAW key is returned ONCE in the
 *                  response and never again.
 *
 * Both require the `admin:keys` scope. The settings UI (session auth) is
 * the primary management surface; this REST API exists for programmatic
 * consumers holding an admin:keys key.
 */
export const Route = createFileRoute("/api/keys")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const gate = await requireAdminKey(request);
        if ("response" in gate) return gate.response;
        const metas = await listApiKeys(gate.key.workspaceId);
        await auditKeyAction(gate.key, "api.keys.listed", null, { count: metas.length });
        return Response.json({ keys: metas }, { headers: rateLimitHeaders(gate.rateLimit) });
      },

      POST: async ({ request }) => {
        const gate = await requireAdminKey(request);
        if ("response" in gate) return gate.response;

        let input: unknown;
        try {
          input = await request.json();
        } catch {
          return Response.json({ error: "invalid JSON" }, { status: 400 });
        }
        const parsed = z
          .object({
            name: z.string().trim().min(1).max(80),
            scopes: z.array(z.string()).min(1),
            rate_limit_per_min: z.number().int().positive().max(1000).optional(),
            expires_at: z.string().datetime({ offset: true }).nullable().optional(),
          })
          .safeParse(input);
        if (!parsed.success) {
          return Response.json(
            { error: `invalid input: ${parsed.error.issues[0]?.message ?? "validation failed"}` },
            { status: 400 },
          );
        }

        try {
          if (!gate.key.createdBy) {
            return Response.json(
              { error: "this API key has no owning user and cannot create keys" },
              { status: 403, headers: rateLimitHeaders(gate.rateLimit) },
            );
          }
          const created = await createApiKey(
            {
              workspaceId: gate.key.workspaceId,
              name: parsed.data.name,
              scopes: parsed.data.scopes,
              rateLimitPerMin: parsed.data.rate_limit_per_min,
              expiresAt: parsed.data.expires_at ?? null,
              createdBy: gate.key.createdBy,
            },
            undefined,
          );
          await auditKeyAction(gate.key, "api.keys.created", created.meta.id, {
            name: created.meta.name,
            scopes: created.meta.scopes,
          });
          // rawKey is surfaced HERE ONLY — never stored, never logged.
          return Response.json(
            { key: created.meta, raw_key: created.rawKey },
            { status: 201, headers: rateLimitHeaders(gate.rateLimit) },
          );
        } catch (e) {
          return Response.json(
            { error: e instanceof Error ? e.message : "could not create API key" },
            { status: 400 },
          );
        }
      },
    },
  },
});
