import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  debitMinutesForJob,
  debitOneCreditForProject,
  OUT_OF_CREDITS_MESSAGE,
  refundMinutesForJob,
} from "./credits";

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

describe("debitMinutesForJob", () => {
  function minutesMock(result: { data: unknown; error: { message: string } | null }) {
    const rpc = vi.fn().mockResolvedValue(result);
    return { rpc, admin: { rpc } as unknown as SupabaseClient<Database> };
  }

  it("calls debit_credits_for_minutes with minutes, reason, and job ref", async () => {
    const { rpc, admin } = minutesMock({ data: 96, error: null });
    await debitMinutesForJob(admin, "user-1", "job-1", 4, "Video render (4 finished min)");
    expect(rpc).toHaveBeenCalledWith("debit_credits_for_minutes", {
      p_user_id: "user-1",
      p_minutes: 4,
      p_reason: "Video render (4 finished min)",
      p_ref_id: "job-1",
    });
  });

  it("rounds fractional minutes up to a whole credit", async () => {
    const { rpc, admin } = minutesMock({ data: 96, error: null });
    await debitMinutesForJob(admin, "user-1", "job-1", 2.5, "r");
    expect(rpc).toHaveBeenCalledWith(
      "debit_credits_for_minutes",
      expect.objectContaining({ p_minutes: 3 }),
    );
  });

  it("throws the friendly out-of-credits message on INSUFFICIENT_CREDITS", async () => {
    const { admin } = minutesMock({ data: null, error: { message: "INSUFFICIENT_CREDITS" } });
    await expect(debitMinutesForJob(admin, "user-1", "job-1", 4, "r")).rejects.toThrow(
      OUT_OF_CREDITS_MESSAGE,
    );
  });

  it("rethrows unexpected RPC errors", async () => {
    const { admin } = minutesMock({ data: null, error: { message: "boom" } });
    await expect(debitMinutesForJob(admin, "user-1", "job-1", 4, "r")).rejects.toThrow("boom");
  });
});

describe("refundMinutesForJob", () => {
  function minutesMock(result: { data: unknown; error: { message: string } | null }) {
    const rpc = vi.fn().mockResolvedValue(result);
    return { rpc, admin: { rpc } as unknown as SupabaseClient<Database> };
  }

  it("calls refund_credits_for_minutes with the job ref", async () => {
    const { rpc, admin } = minutesMock({ data: 100, error: null });
    await refundMinutesForJob(admin, "user-1", "job-1", 4, "Refund: failed render job-1");
    expect(rpc).toHaveBeenCalledWith("refund_credits_for_minutes", {
      p_user_id: "user-1",
      p_minutes: 4,
      p_reason: "Refund: failed render job-1",
      p_ref_id: "job-1",
    });
  });

  it("passes the same ref on repeat calls (server RPC guarantees the no-op)", async () => {
    const { rpc, admin } = minutesMock({ data: 100, error: null });
    await refundMinutesForJob(admin, "user-1", "job-1", 4, "Refund: failed render job-1");
    await refundMinutesForJob(admin, "user-1", "job-1", 4, "Refund: failed render job-1");
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "refund_credits_for_minutes",
      expect.objectContaining({ p_ref_id: "job-1" }),
    );
  });
});
