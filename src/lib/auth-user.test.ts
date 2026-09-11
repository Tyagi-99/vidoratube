import { describe, expect, it } from "vitest";
import { isAppUser, locationToNext, safeAuthNext } from "./auth-user";

describe("isAppUser", () => {
  it("rejects missing users and anonymous guests", () => {
    expect(isAppUser(null)).toBe(false);
    expect(isAppUser(undefined)).toBe(false);
    expect(isAppUser({ is_anonymous: true })).toBe(false);
  });

  it("accepts a normal signed-in user", () => {
    expect(isAppUser({ is_anonymous: false })).toBe(true);
    expect(isAppUser({})).toBe(true);
  });
});

describe("safeAuthNext", () => {
  it("keeps in-app studio create links", () => {
    expect(safeAuthNext("/studio?create=script")).toBe("/studio?create=script");
    expect(safeAuthNext("/projects")).toBe("/projects");
  });

  it("rebuilds a studio create URL from router location", () => {
    expect(
      locationToNext({ pathname: "/studio", searchStr: "?create=script", search: { create: "script" } }),
    ).toBe("/studio?create=script");
    expect(locationToNext({ pathname: "/studio", search: { create: "voiceover" } })).toBe(
      "/studio?create=voiceover",
    );
    expect(locationToNext({ pathname: "/projects" })).toBe("/projects");
  });

  it("rejects open redirects and missing values", () => {
    expect(safeAuthNext(undefined)).toBe("/studio");
    expect(safeAuthNext("//evil.example")).toBe("/studio");
    expect(safeAuthNext("https://evil.example")).toBe("/studio");
    expect(safeAuthNext("/auth")).toBe("/studio");
  });
});
