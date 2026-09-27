import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  WORKSPACE_PERMISSIONS,
  WORKSPACE_ROLE_RANK,
  canChangeMemberRole,
  enforceWorkspaceRole,
  getWorkspaceRole,
  isWorkspaceRole,
  requireWorkspaceRole,
  roleCan,
  type WorkspaceAction,
  type WorkspaceRole,
} from "./workspace-auth.server";

const ALL: WorkspaceRole[] = ["owner", "admin", "strategist", "creator", "viewer", "client"];

/** Mock supabase client: canned membership row (or null) for any query. */
function mockClient(role: unknown, error: string | null = null) {
  const maybeSingle = async () => ({
    data: role === null ? null : { role },
    error: error ? { message: error } : null,
  });
  const builder = {
    eq: () => builder,
    maybeSingle,
  };
  return {
    from: () => ({ select: () => builder }),
  } as unknown as SupabaseClient<Database>;
}

describe("workspace role vocabulary", () => {
  it("accepts the six program roles, rejects legacy/unknown strings", () => {
    for (const r of ALL) expect(isWorkspaceRole(r)).toBe(true);
    expect(isWorkspaceRole("editor")).toBe(false);
    expect(isWorkspaceRole("superadmin")).toBe(false);
    expect(isWorkspaceRole(null)).toBe(false);
    expect(isWorkspaceRole(undefined)).toBe(false);
  });

  it("ranks owner above admin above everyone else", () => {
    expect(WORKSPACE_ROLE_RANK.owner).toBeGreaterThan(WORKSPACE_ROLE_RANK.admin);
    expect(WORKSPACE_ROLE_RANK.admin).toBeGreaterThan(WORKSPACE_ROLE_RANK.strategist);
    expect(WORKSPACE_ROLE_RANK.strategist).toBeGreaterThan(WORKSPACE_ROLE_RANK.creator);
    expect(WORKSPACE_ROLE_RANK.creator).toBeGreaterThan(WORKSPACE_ROLE_RANK.viewer);
    expect(WORKSPACE_ROLE_RANK.viewer).toBeGreaterThan(WORKSPACE_ROLE_RANK.client);
  });
});

describe("getWorkspaceRole", () => {
  it("maps legacy DB roles to the new vocabulary", async () => {
    expect(await getWorkspaceRole(mockClient("owner"), "ws", "u")).toBe("owner");
    // Legacy editor managed workspace data -> creator.
    expect(await getWorkspaceRole(mockClient("editor"), "ws", "u")).toBe("creator");
    // Legacy viewer was read + sign-off -> client.
    expect(await getWorkspaceRole(mockClient("viewer"), "ws", "u")).toBe("client");
  });

  it("passes new-vocabulary roles through unchanged", async () => {
    for (const r of ["owner", "admin", "strategist", "creator", "client"] as WorkspaceRole[]) {
      expect(await getWorkspaceRole(mockClient(r), "ws", "u")).toBe(r);
    }
    // "viewer" is claimed by the legacy map (see module doc): every
    // "viewer" row in the current schema is a client seat.
    expect(await getWorkspaceRole(mockClient("viewer"), "ws", "u")).toBe("client");
  });

  it("returns null for non-members (no row)", async () => {
    expect(await getWorkspaceRole(mockClient(null), "ws", "u")).toBeNull();
  });

  it("fails closed on unknown role strings", async () => {
    expect(await getWorkspaceRole(mockClient("superadmin"), "ws", "u")).toBeNull();
  });

  it("throws on database errors", async () => {
    await expect(getWorkspaceRole(mockClient("owner", "boom"), "ws", "u")).rejects.toThrow("boom");
  });
});

describe("permission matrix", () => {
  it("member.invite and member.remove: owner + admin only", () => {
    for (const action of ["member.invite", "member.remove"] as WorkspaceAction[]) {
      expect(roleCan("owner", action)).toBe(true);
      expect(roleCan("admin", action)).toBe(true);
      for (const r of ["strategist", "creator", "viewer", "client"] as WorkspaceRole[]) {
        expect(roleCan(r, action)).toBe(false);
      }
    }
  });

  it("client role: read + sign-off only", () => {
    expect(roleCan("client", "workspace.read")).toBe(true);
    expect(roleCan("client", "member.read")).toBe(true);
    expect(roleCan("client", "approval.decide")).toBe(true);
    expect(roleCan("client", "workspace.data")).toBe(false);
    expect(roleCan("client", "approval.request")).toBe(false);
    expect(roleCan("client", "member.invite")).toBe(false);
    expect(roleCan("client", "workspace.update")).toBe(false);
    expect(roleCan("client", "workspace.delete")).toBe(false);
  });

  it("viewer: read-only, no sign-off, no data writes", () => {
    expect(roleCan("viewer", "workspace.read")).toBe(true);
    expect(roleCan("viewer", "approval.decide")).toBe(false);
    expect(roleCan("viewer", "workspace.data")).toBe(false);
  });

  it("workspace.data and approval.request: owner/admin/strategist/creator", () => {
    for (const action of ["workspace.data", "approval.request"] as WorkspaceAction[]) {
      for (const r of ["owner", "admin", "strategist", "creator"] as WorkspaceRole[]) {
        expect(roleCan(r, action)).toBe(true);
      }
      for (const r of ["viewer", "client"] as WorkspaceRole[]) {
        expect(roleCan(r, action)).toBe(false);
      }
    }
  });

  it("workspace.delete: owner only", () => {
    expect(roleCan("owner", "workspace.delete")).toBe(true);
    for (const r of ["admin", "strategist", "creator", "viewer", "client"] as WorkspaceRole[]) {
      expect(roleCan(r, "workspace.delete")).toBe(false);
    }
  });

  it("publish.approve is NOT in the matrix — the server approvals gate (D61/D62) owns it", () => {
    expect("publish.approve" in WORKSPACE_PERMISSIONS).toBe(false);
  });

  it("null/undefined roles are denied everything", () => {
    for (const action of Object.keys(WORKSPACE_PERMISSIONS) as WorkspaceAction[]) {
      expect(roleCan(null, action)).toBe(false);
      expect(roleCan(undefined, action)).toBe(false);
    }
  });
});

describe("canChangeMemberRole (admin cannot touch owners)", () => {
  it("owner can grant and revoke any role", () => {
    expect(
      canChangeMemberRole({ actorRole: "owner", targetCurrentRole: "admin", newRole: "owner" }),
    ).toBe(true);
    expect(
      canChangeMemberRole({ actorRole: "owner", targetCurrentRole: "owner", newRole: "viewer" }),
    ).toBe(true);
  });

  it("admin cannot promote anyone to owner", () => {
    expect(
      canChangeMemberRole({ actorRole: "admin", targetCurrentRole: "creator", newRole: "owner" }),
    ).toBe(false);
  });

  it("admin cannot demote or re-role an existing owner", () => {
    expect(
      canChangeMemberRole({ actorRole: "admin", targetCurrentRole: "owner", newRole: "admin" }),
    ).toBe(false);
    expect(
      canChangeMemberRole({ actorRole: "admin", targetCurrentRole: "owner", newRole: "viewer" }),
    ).toBe(false);
  });

  it("admin can change roles between non-owner roles", () => {
    expect(
      canChangeMemberRole({ actorRole: "admin", targetCurrentRole: "creator", newRole: "viewer" }),
    ).toBe(true);
    expect(
      canChangeMemberRole({ actorRole: "admin", targetCurrentRole: "viewer", newRole: "admin" }),
    ).toBe(true);
  });

  it("roles without member.changeRole are denied", () => {
    for (const r of ["strategist", "creator", "viewer", "client", null] as const) {
      expect(
        canChangeMemberRole({ actorRole: r, targetCurrentRole: "viewer", newRole: "creator" }),
      ).toBe(false);
    }
  });
});

describe("enforceWorkspaceRole (middleware core logic)", () => {
  it("returns the role when it is allowed", async () => {
    const role = await enforceWorkspaceRole({
      supabase: mockClient("editor"), // legacy -> creator
      workspaceId: "ws",
      userId: "u",
      allowedRoles: ["owner", "admin", "creator"],
      action: "manage members",
    });
    expect(role).toBe("creator");
  });

  it("hides workspace existence from non-members", async () => {
    await expect(
      enforceWorkspaceRole({
        supabase: mockClient(null),
        workspaceId: "ws",
        userId: "u",
        allowedRoles: ALL,
        action: "view this workspace",
      }),
    ).rejects.toThrow("Workspace not found");
  });

  it("rejects disallowed roles with a Forbidden error naming the role", async () => {
    let err: unknown;
    try {
      await enforceWorkspaceRole({
        supabase: mockClient("viewer"), // legacy -> client
        workspaceId: "ws",
        userId: "u",
        allowedRoles: ["owner", "admin"],
        action: "manage members",
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/Forbidden/);
    expect((err as Error).message).toContain("client");
  });

  it("the middleware factory composes over requireAppUser", () => {
    const mw = requireWorkspaceRole(null, ["owner", "admin"]);
    expect(mw).toBeDefined();
    // Fixed-workspace variant is also constructible.
    expect(
      requireWorkspaceRole("11111111-1111-4111-8111-111111111111", ["owner"]),
    ).toBeDefined();
  });
});
