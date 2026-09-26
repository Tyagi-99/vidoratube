import { describe, expect, it } from "vitest";
import { sha1Hex } from "./sha1";

describe("sha1 (pure-JS, client-safe)", () => {
  it("matches standard SHA-1 test vectors (byte-identical to node:crypto)", () => {
    // Vectors cross-checked against node:crypto, openssl, sha1sum and
    // Python hashlib — never hand-type these from memory.
    expect(sha1Hex("")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
    expect(sha1Hex("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(sha1Hex("The quick brown fox jumps over the lazy dog")).toBe(
      "2fd4e1c67a2d28fced849ee1bb76e7391b93eb12",
    );
  });

  it("handles multi-block inputs identically", () => {
    // 1000 chars -> spans multiple 64-byte blocks, exercises padding logic.
    expect(sha1Hex("a".repeat(1000))).toBe(
      "291e9a6c66994949b57ba5e650361e98fc36b1ba",
    );
  });

  it("is deterministic", () => {
    expect(sha1Hex("namespace:event-123")).toBe(sha1Hex("namespace:event-123"));
  });
});
