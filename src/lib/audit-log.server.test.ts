import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  inserts: [] as { table: string; row: Record<string, unknown> }[],
  nextError: null as { message: string } | null,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        state.inserts.push({ table, row });
        return { error: state.nextError };
      },
    }),
  },
}));

import { AUDIT_ACTIONS, writeAuditLog } from "./audit-log.server";

beforeEach(() => {
  state.inserts.length = 0;
  state.nextError = null;
});

describe("writeAuditLog", () => {
  it("writes the pinned-contract payload shape to audit_logs", async () => {
    await writeAuditLog({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      actorUserId: "22222222-2222-4222-8222-222222222222",
      action: "member.invited",
      entityType: "workspace_member",
      entityId: "33333333-3333-4333-8333-333333333333",
      metadata: { invitedEmail: "client@example.com", role: "viewer" },
    });

    expect(state.inserts).toHaveLength(1);
    const { table, row } = state.inserts[0]!;
    expect(table).toBe("audit_logs");
    // Exact pinned contract columns.
    expect(row).toEqual({
      workspace_id: "11111111-1111-4111-8111-111111111111",
      actor_user_id: "22222222-2222-4222-8222-222222222222",
      action: "member.invited",
      entity_type: "workspace_member",
      entity_id: "33333333-3333-4333-8333-333333333333",
      metadata: { invitedEmail: "client@example.com", role: "viewer" },
    });
    expect(Object.keys(row).sort()).toEqual(
      ["action", "actor_user_id", "entity_id", "entity_type", "metadata", "workspace_id"].sort(),
    );
  });

  it("defaults metadata to an empty object", async () => {
    await writeAuditLog({
      workspaceId: null,
      actorUserId: "u",
      action: "workspace.created",
      entityType: "workspace",
      entityId: "w",
    });
    expect(state.inserts[0]!.row["metadata"]).toEqual({});
    expect(state.inserts[0]!.row["workspace_id"]).toBeNull();
  });

  it("only allows the four audited actions", () => {
    expect([...AUDIT_ACTIONS].sort()).toEqual(
      ["member.invited", "member.removed", "member.role_changed", "workspace.created"].sort(),
    );
  });

  it("throws on write failure so callers can decide the policy", async () => {
    state.nextError = { message: "relation does not exist" };
    await expect(
      writeAuditLog({
        workspaceId: "w",
        actorUserId: "u",
        action: "member.removed",
        entityType: "workspace_member",
        entityId: "m",
      }),
    ).rejects.toThrow(/audit log write failed/);
  });
});
