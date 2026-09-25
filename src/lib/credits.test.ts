import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { debitOneCreditForProject, OUT_OF_CREDITS_MESSAGE } from "./credits";

function mockAdmin(result: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { rpc, admin: { rpc } as unknown as SupabaseClient<Database> };
}

describe("debitOneCreditForProject", () => {
  it("calls the idempotent debit RPC with the project id as ref", async () => {
    const { rpc, admin } = mockAdmin({ data: 9, error: null });
    await debitOneCreditForProject(admin, "user-1", "project-1", "Voiceover project: X");
    expect(rpc).toHaveBeenCalledWith("debit_credits_for_job_once", {
      p_user_id: "user-1",
      p_reason: "Voiceover project: X",
      p_job_id: "project-1",
    });
  });

  it("throws the friendly out-of-credits message on INSUFFICIENT_CREDITS", async () => {
    const { admin } = mockAdmin({ data: null, error: { message: "INSUFFICIENT_CREDITS" } });
    await expect(
      debitOneCreditForProject(admin, "user-1", "project-1", "r"),
    ).rejects.toThrow(OUT_OF_CREDITS_MESSAGE);
  });

  it("rethrows unexpected RPC errors", async () => {
    const { admin } = mockAdmin({ data: null, error: { message: "PROFILE_NOT_FOUND" } });
    await expect(debitOneCreditForProject(admin, "user-1", "project-1", "r")).rejects.toThrow(
      "PROFILE_NOT_FOUND",
    );
  });
});
