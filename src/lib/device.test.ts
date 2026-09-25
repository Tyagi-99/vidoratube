import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getDeviceHash } from "./device";

describe("getDeviceHash", () => {
  const realLocalStorage = globalThis.localStorage;

  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } satisfies Storage as unknown as Storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (realLocalStorage !== undefined) {
      globalThis.localStorage = realLocalStorage;
    }
  });

  it("generates and persists a stable id", () => {
    const first = getDeviceHash();
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(getDeviceHash()).toBe(first);
  });

  it("returns empty string when storage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {},
    });
    expect(getDeviceHash()).toBe("");
  });
});
