import { describe, expect, it, vi } from "vitest";
import { MOCK_LICENSE, mockStock, resolveStockProviders } from "./mock";
import { pexels, pixabay } from "../providers/stock.server";

describe("mock stock provider", () => {
  it("is clearly marked as mock on every asset", async () => {
    const assets = await mockStock.search("volcano eruption", "video", 4);
    expect(assets).toHaveLength(4);
    for (const a of assets) {
      expect(a.provider).toBe("mock");
      expect(a.license).toBe(MOCK_LICENSE);
      expect(a.license).toMatch(/not licensed/i);
      expect(a.url).toMatch(/^mock:\/\//);
      expect(a.source_url).toMatch(/^mock:\/\//);
    }
  });

  it("is deterministic and performs no network I/O", async () => {
    const first = await mockStock.search("ocean waves", "photo", 3);
    const second = await mockStock.search("ocean waves", "photo", 3);
    expect(second).toEqual(first);
    // mock:// URLs are not fetchable — nothing leaves the machine.
    expect(first[0]!.url).not.toMatch(/^https?:\/\//);
  });

  it("reports itself configured (it is the always-available fallback)", () => {
    expect(mockStock.configured()).toBe(true);
    expect(mockStock.id).toBe("mock");
  });
});

describe("resolveStockProviders", () => {
  it("defaults to the clearly-marked mock when no API keys are set", () => {
    const savedPexels = process.env["PEXELS_API_KEY"];
    const savedPixabay = process.env["PIXABAY_API_KEY"];
    delete process.env["PEXELS_API_KEY"];
    delete process.env["PIXABAY_API_KEY"];
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      // Real providers must agree they are unconfigured without keys.
      expect(pexels.configured()).toBe(false);
      expect(pixabay.configured()).toBe(false);
      const { providers, mock } = resolveStockProviders();
      expect(mock).toBe(true);
      expect(providers.map((p) => p.id)).toEqual(["mock"]);
      expect(info).toHaveBeenCalledWith(expect.stringContaining("mock stock provider"));
    } finally {
      info.mockRestore();
      if (savedPexels !== undefined) process.env["PEXELS_API_KEY"] = savedPexels;
      if (savedPixabay !== undefined) process.env["PIXABAY_API_KEY"] = savedPixabay;
    }
  });

  it("prefers real providers when a key is configured", () => {
    const saved = process.env["PEXELS_API_KEY"];
    process.env["PEXELS_API_KEY"] = "test-key";
    try {
      const { providers, mock } = resolveStockProviders();
      expect(mock).toBe(false);
      expect(providers.map((p) => p.id)).toContain("pexels");
    } finally {
      if (saved !== undefined) process.env["PEXELS_API_KEY"] = saved;
      else delete process.env["PEXELS_API_KEY"];
    }
  });
});
