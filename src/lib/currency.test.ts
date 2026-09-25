import { describe, expect, it } from "vitest";
import { detectCurrencyFromHeaders, formatMoney } from "./currency";

describe("detectCurrencyFromHeaders", () => {
  const get =
    (headers: Record<string, string>) =>
    (name: string): string | null =>
      headers[name.toLowerCase()] ?? null;

  it("returns INR for India via cf-ipcountry", () => {
    expect(detectCurrencyFromHeaders(get({ "cf-ipcountry": "IN" }))).toBe("INR");
  });

  it("returns USD for other countries", () => {
    expect(detectCurrencyFromHeaders(get({ "cf-ipcountry": "US" }))).toBe("USD");
    expect(detectCurrencyFromHeaders(get({ "cf-ipcountry": "GB" }))).toBe("USD");
  });

  it("falls back through the header list", () => {
    expect(detectCurrencyFromHeaders(get({ "x-vercel-ip-country": "IN" }))).toBe("INR");
  });

  it("returns USD when no country header is present (unknown -> USD)", () => {
    expect(detectCurrencyFromHeaders(get({}))).toBe("USD");
    expect(detectCurrencyFromHeaders(get({ "cf-ipcountry": "" }))).toBe("USD");
  });

  it("is case-insensitive", () => {
    expect(detectCurrencyFromHeaders(get({ "cf-ipcountry": "in" }))).toBe("INR");
  });
});

describe("formatMoney", () => {
  it("formats USD", () => {
    expect(formatMoney("USD", 19)).toBe("$19");
    expect(formatMoney("USD", 19.5)).toBe("$19.50");
  });

  it("formats INR with Indian digit grouping", () => {
    expect(formatMoney("INR", 1599)).toBe("₹1,599");
    expect(formatMoney("INR", 11999)).toBe("₹11,999");
  });
});
