import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getDeviceHash } from "./device";

describe("getDeviceHash", () => {
  const realLocalStorage = globalThis.localStorage;

  beforeEach(() => {
    const store = new Map<string, string>();
    const stub = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => void store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    } satisfies Storage;
    vi.stubGlobal("localStorage", stub);
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
