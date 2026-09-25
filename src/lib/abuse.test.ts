import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  ABUSE_CLUSTER_LIMIT,
  checkAbuseCluster,
  parseClientIp,
} from "./abuse";

function mockAdmin(rpcImpl: (args: unknown) => unknown) {
  const rpc = vi.fn().mockImplementation(async (_fn: string, args: unknown) => rpcImpl(args));
  return { rpc, admin: { rpc } as unknown as SupabaseClient<Database> };
}

describe("parseClientIp", () => {
  it("takes the first entry of X-Forwarded-For", () => {
    const h = new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
    expect(parseClientIp(h)).toBe("1.2.3.4");
  });

  it("trims whitespace", () => {
    const h = new Headers({ "x-forwarded-for": "  9.9.9.9  " });
    expect(parseClientIp(h)).toBe("9.9.9.9");
  });

  it("falls back to cf-connecting-ip then x-real-ip", () => {
    expect(parseClientIp(new Headers({ "cf-connecting-ip": "2.2.2.2" }))).toBe("2.2.2.2");
    expect(parseClientIp(new Headers({ "x-real-ip": "3.3.3.3" }))).toBe("3.3.3.3");
  });

  it("returns null when no IP headers are present", () => {
    expect(parseClientIp(new Headers())).toBeNull();
  });
});

describe("checkAbuseCluster", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing when there is no IP and no device hash (fail open)", async () => {
    const { rpc, admin } = mockAdmin(() => ({ data: 99, error: null }));
    // In the node test env there is no request context, so getClientIp() -> null.
    await checkAbuseCluster(admin, { userId: "u1", signalType: "job_create" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("throws when the cluster exceeds the limit", async () => {
    const { rpc, admin } = mockAdmin(() => ({ data: ABUSE_CLUSTER_LIMIT + 1, error: null }));
    await expect(
      checkAbuseCluster(admin, {
        userId: "u1",
        signalType: "job_create",
        deviceHash: "dev-1",
      }),
    ).rejects.toThrow(/too many accounts/i);
    expect(rpc).toHaveBeenCalledWith("log_abuse_signal", {
      p_user_id: "u1",
      p_ip: null,
      p_device_hash: "dev-1",
      p_signal_type: "job_create",
    });
  });

  it("allows when the cluster is at the limit", async () => {
    const { admin } = mockAdmin(() => ({ data: ABUSE_CLUSTER_LIMIT, error: null }));
    await expect(
      checkAbuseCluster(admin, { userId: "u1", signalType: "job_create", deviceHash: "dev-1" }),
    ).resolves.toBeUndefined();
  });

  it("fails open when the RPC errors", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin } = mockAdmin(() => ({ data: null, error: { message: "db down" } }));
    await expect(
      checkAbuseCluster(admin, { userId: "u1", signalType: "job_create", deviceHash: "dev-1" }),
    ).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });
});
