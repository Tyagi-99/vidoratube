import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimJobForUpload,
  createPkcePair,
  decryptToken,
  encryptToken,
  hmac,
  publishPrecheck,
  signState,
  verifyState,
} from "./youtube.server";

const ENC_KEY = randomBytes(32).toString("base64");
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {
    YOUTUBE_TOKEN_ENCRYPTION_KEY: process.env["YOUTUBE_TOKEN_ENCRYPTION_KEY"],
    GOOGLE_OAUTH_CLIENT_SECRET: process.env["GOOGLE_OAUTH_CLIENT_SECRET"],
  };
  process.env["YOUTUBE_TOKEN_ENCRYPTION_KEY"] = ENC_KEY;
  process.env["GOOGLE_OAUTH_CLIENT_SECRET"] = "test-client-secret";
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.useRealTimers();
});

describe("token encryption at rest", () => {
  it("round-trips a refresh token", async () => {
    const plain = "1//0g-refresh-token-value-xyz";
    const stored = await encryptToken(plain);
    expect(stored).not.toContain(plain);
    expect(stored.startsWith("enc1:")).toBe(true);
    expect(await decryptToken(stored)).toBe(plain);
  });

  it("uses a fresh IV per encryption", async () => {
    const a = await encryptToken("same-token");
    const b = await encryptToken("same-token");
    expect(a).not.toBe(b);
    expect(await decryptToken(a)).toBe("same-token");
    expect(await decryptToken(b)).toBe("same-token");
  });

  it("passes legacy plaintext rows through for migration", async () => {
    expect(await decryptToken("1//0g-old-plaintext-token")).toBe("1//0g-old-plaintext-token");
  });

  it("returns null for null/empty/tampered values", async () => {
    expect(await decryptToken(null)).toBeNull();
    expect(await decryptToken("")).toBeNull();
    const stored = await encryptToken("token");
    // Flip a character in the ciphertext portion.
    const tampered = stored.slice(0, -2) + (stored.endsWith("AA") ? "BB" : "AA");
    expect(await decryptToken(tampered)).toBeNull();
    expect(await decryptToken("enc1:broken")).toBeNull();
  });

  it("fails closed when the encryption key is missing", async () => {
    delete process.env["YOUTUBE_TOKEN_ENCRYPTION_KEY"];
    await expect(encryptToken("token")).rejects.toThrow("YOUTUBE_TOKEN_ENCRYPTION_KEY");
    // Encrypted rows read as null without the key (never as plaintext);
    // callers surface a "reconnect your channel" error from there.
    process.env["YOUTUBE_TOKEN_ENCRYPTION_KEY"] = ENC_KEY;
    const stored = await encryptToken("token");
    delete process.env["YOUTUBE_TOKEN_ENCRYPTION_KEY"];
    expect(await decryptToken(stored)).toBeNull();
    // Legacy plaintext rows still read without the key (migration-friendly).
    expect(await decryptToken("1//0g-old-plaintext")).toBe("1//0g-old-plaintext");
  });

  it("rejects a malformed key", async () => {
    process.env["YOUTUBE_TOKEN_ENCRYPTION_KEY"] = randomBytes(16).toString("base64");
    await expect(encryptToken("token")).rejects.toThrow("32 bytes");
  });
});

describe("PKCE", () => {
  it("produces a verifier/challenge pair where challenge = base64url(sha256(verifier))", async () => {
    const { verifier, challenge } = await createPkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const expected = createHash("sha256")
      .update(verifier)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(challenge).toBe(expected);
  });
});

describe("signed OAuth state", () => {
  it("round-trips userId and verifier", async () => {
    const { state, verifier } = await signState("user-123");
    const verified = await verifyState(state);
    expect(verified).toEqual({ userId: "user-123", verifier });
  });

  it("rejects a tampered signature", async () => {
    const { state } = await signState("user-123");
    const tampered = state.slice(0, -1) + (state.endsWith("0") ? "1" : "0");
    expect(await verifyState(tampered)).toBeNull();
  });

  it("rejects malformed states", async () => {
    expect(await verifyState("nope")).toBeNull();
    expect(await verifyState("a.b.c")).toBeNull();
    expect(await verifyState("a.b.c.d.e")).toBeNull();
  });

  it("rejects a non-numeric issued timestamp (NaN expiry bypass)", async () => {
    const verifier = "verifier-value";
    const payload = `user-123.NaN.${verifier}`;
    const state = `${payload}.${await hmac(payload)}`;
    expect(await verifyState(state)).toBeNull();
  });

  it("rejects expired states", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { state } = await signState("user-123");
    vi.setSystemTime(new Date("2026-01-01T00:16:00Z"));
    expect(await verifyState(state)).toBeNull();
  });

  it("fails closed when the signing secret is missing", async () => {
    delete process.env["GOOGLE_OAUTH_CLIENT_SECRET"];
    await expect(signState("user-123")).rejects.toThrow("GOOGLE_OAUTH_CLIENT_SECRET");
  });
});

describe("publishPrecheck", () => {
  it("returns the existing video id for an already-published job", () => {
    expect(
      publishPrecheck({ youtube_status: "published", youtube_video_id: "abc123" }),
    ).toEqual({ action: "return-existing", videoId: "abc123" });
  });

  it("refuses a second publish while one is in flight", () => {
    expect(publishPrecheck({ youtube_status: "uploading", youtube_video_id: null })).toEqual({
      action: "already-uploading",
    });
  });

  it("claims fresh, failed, and never-attempted jobs", () => {
    for (const status of [null, "failed: boom", "published"]) {
      expect(
        publishPrecheck({
          youtube_status: status,
          youtube_video_id: status === "published" ? null : null,
        }),
      ).toEqual({ action: "claim" });
    }
  });
});

describe("claimJobForUpload", () => {
  function mockClient(claimed: { id: string } | null) {
    const calls: string[] = [];
    const chain: Record<string, (...args: never[]) => unknown> = {};
    chain["update"] = () => {
      calls.push("update");
      return chain;
    };
    chain["eq"] = (...args: never[]) => {
      calls.push(`eq:${String(args[0])}=${String(args[1])}`);
      return chain;
    };
    chain["is"] = (...args: never[]) => {
      calls.push(`is:${String(args[0])}=${String(args[1])}`);
      return chain;
    };
    chain["select"] = () => chain;
    chain["maybeSingle"] = async () => ({ data: claimed });
    const client = { from: () => chain } as unknown as SupabaseClient<Database>;
    return { client, calls };
  }

  it("returns true when the conditional update claims the row", async () => {
    const { client, calls } = mockClient({ id: "job-1" });
    expect(await claimJobForUpload(client, "job-1", null)).toBe(true);
    expect(calls).toContain("is:youtube_status=null");
  });

  it("matches on the exact previous status for non-null values", async () => {
    const { client, calls } = mockClient({ id: "job-1" });
    expect(await claimJobForUpload(client, "job-1", "failed: boom")).toBe(true);
    expect(calls).toContain("eq:youtube_status=failed: boom");
  });

  it("returns false when another caller already claimed the job", async () => {
    const { client } = mockClient(null);
    expect(await claimJobForUpload(client, "job-1", null)).toBe(false);
  });
});
