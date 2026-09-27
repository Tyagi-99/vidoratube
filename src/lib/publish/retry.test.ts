import { describe, expect, it, vi } from "vitest";
import { isTransientError, withTransientRetry } from "./retry";

describe("isTransientError", () => {
  it.each([
    "YouTube rejected the schedule (503): backend error",
    "HTTP 429 Too Many Requests",
    "Meta publish: 500 internal",
    "IG container status: network error — fetch failed",
    "request failed: ECONNRESET",
    "socket hang up",
    "The operation timed out",
  ])("treats %p as transient", (message) => {
    expect(isTransientError(new Error(message))).toBe(true);
  });

  it.each([
    "YouTube rejected the schedule (400): invalid publishAt",
    "HTTP 401 Unauthorized",
    "HTTP 403: quota exceeded for videos.insert",
    "HTTP 404: video not found",
    "scheduledFor must be a future datetime.",
    "This video hasn't been approved for publishing yet.",
    "Publishing is limited to the founder's designated test channel.",
  ])("treats %p as non-transient (never retried)", (message) => {
    expect(isTransientError(new Error(message))).toBe(false);
  });
});

describe("withTransientRetry", () => {
  it("retries transient failures and returns the eventual success", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("HTTP 503"))
      .mockRejectedValueOnce(new Error("network error — fetch failed"))
      .mockResolvedValue("ok");
    const result = await withTransientRetry(fn, { sleep, random: () => 0 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    // Exponential backoff: 1000ms, then 2000ms (jitter 0).
    expect(sleep).toHaveBeenNthCalledWith(1, 1000);
    expect(sleep).toHaveBeenNthCalledWith(2, 2000);
  });

  it("throws a non-transient error immediately without retrying", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn().mockRejectedValue(new Error("HTTP 400: bad request"));
    await expect(withTransientRetry(fn, { sleep })).rejects.toThrow("HTTP 400");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("gives up after maxAttempts and rethrows the last error", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn().mockRejectedValue(new Error("HTTP 500"));
    await expect(withTransientRetry(fn, { maxAttempts: 2, sleep, random: () => 0 })).rejects.toThrow(
      "HTTP 500",
    );
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("caps the backoff at maxMs", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn().mockRejectedValue(new Error("HTTP 503"));
    await expect(
      withTransientRetry(fn, { maxAttempts: 4, baseMs: 20000, maxMs: 12000, sleep, random: () => 0 }),
    ).rejects.toThrow("HTTP 503");
    expect(sleep).toHaveBeenNthCalledWith(1, 12000);
    expect(sleep).toHaveBeenNthCalledWith(2, 12000);
    expect(sleep).toHaveBeenNthCalledWith(3, 12000);
  });

  it("does not retry validation/auth failures even when they look retryable-ish", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn().mockRejectedValue(new Error("invalid_grant: token expired"));
    await expect(withTransientRetry(fn, { sleep })).rejects.toThrow("invalid_grant");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
