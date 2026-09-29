/**
 * Behavioral tests for reserveRenderBilling (P1-5, 2026-09-29 audit):
 * workspace/project scope must reach the debit RPC so the atomic budget
 * check inside the RPC can enforce caps; budget errors must surface as
 * friendly messages.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { reserveRenderBilling } from "./billing.functions";

function rpcMock(result: { error: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { rpc, admin: { rpc } as unknown as SupabaseClient<Database> };
}

describe("reserveRenderBilling", () => {
  it("passes workspace/project scope to the debit RPC", async () => {
    const { rpc, admin } = rpcMock({ error: null });
    await reserveRenderBilling(admin, "user-1", "render-1", 8, {
      workspaceId: "ws-1",
      projectId: "proj-1",
    });
    expect(rpc).toHaveBeenCalledWith(
      "debit_credits_amount_once",
      expect.objectContaining({
        p_user_id: "user-1",
        p_amount: 8,
        p_ref_id: "render-1",
        p_workspace_id: "ws-1",
        p_project_id: "proj-1",
      }),
    );
  });

  it("sends null scope when none is known", async () => {
    const { rpc, admin } = rpcMock({ error: null });
    await reserveRenderBilling(admin, "user-1", "render-1", 8);
    expect(rpc).toHaveBeenCalledWith(
      "debit_credits_amount_once",
      expect.objectContaining({ p_workspace_id: null, p_project_id: null }),
    );
  });

  it("translates WORKSPACE_BUDGET_EXCEEDED into a friendly message", async () => {
    const { admin } = rpcMock({ error: { message: "WORKSPACE_BUDGET_EXCEEDED" } });
    await expect(reserveRenderBilling(admin, "user-1", "render-1", 8)).rejects.toThrow(
      "monthly credit cap",
    );
  });

  it("translates PROJECT_BUDGET_EXCEEDED into a friendly message", async () => {
    const { admin } = rpcMock({ error: { message: "PROJECT_BUDGET_EXCEEDED" } });
    await expect(reserveRenderBilling(admin, "user-1", "render-1", 8)).rejects.toThrow(
      "credit cap",
    );
  });

  it("keeps the friendly insufficient-credits message", async () => {
    const { admin } = rpcMock({ error: { message: "INSUFFICIENT_CREDITS" } });
    await expect(reserveRenderBilling(admin, "user-1", "render-1", 8)).rejects.toThrow(
      "Not enough credits to start a server render",
    );
  });
});
