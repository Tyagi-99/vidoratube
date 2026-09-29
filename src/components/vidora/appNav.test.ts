import { describe, expect, it } from "vitest";
import { allNavTargets, directLinks, mobileLinks, navGroups } from "./appNav";

/**
 * Regression guard for the Phase 5 nav gap: /publish, /experiments,
 * /learnings and /comments shipped as fully-built pages with zero inbound
 * links — invisible to users. Every top-level feature route must be
 * reachable from the app navigation.
 */
const TOP_LEVEL_FEATURE_ROUTES = [
  "/studio",
  "/projects",
  "/publish",
  "/agent",
  "/research",
  "/create",
  "/thumbnails",
  "/characters",
  "/intelligence",
  "/analytics",
  "/experiments",
  "/learnings",
  "/comments",
  "/agency",
  "/billing",
  "/settings/api-keys",
] as const;

describe("app navigation reachability", () => {
  it("exposes every top-level feature route in the nav", () => {
    const targets = new Set<string>(allNavTargets);
    for (const route of TOP_LEVEL_FEATURE_ROUTES) {
      expect(targets.has(route), `orphan route: ${route} has no nav entry`).toBe(true);
    }
  });

  it("has no duplicate nav targets", () => {
    const seen = new Set<string>();
    for (const item of mobileLinks) {
      const key = item.to + (item.search ? JSON.stringify(item.search) : "");
      expect(seen.has(key), `duplicate nav target: ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it("exposes the Automate Studio upload-footage flows as menu deep links", () => {
    const group = navGroups.find((g) => g.label === "Automate Studio");
    expect(group, "missing Automate Studio nav group").toBeDefined();
    expect(group!.items).toEqual([
      { label: "Voiceover", to: "/studio", search: { create: "voiceover" } },
      { label: "Automatic edit", to: "/studio", search: { create: "auto_edit" } },
    ]);
  });

  it("mobile menu covers everything the desktop nav covers", () => {
    const desktop = new Set<string>([
      ...directLinks.map((i) => i.to),
      ...navGroups.flatMap((g) => g.items.map((i) => i.to)),
    ]);
    const mobile = new Set<string>(mobileLinks.map((i) => i.to));
    for (const t of desktop) {
      expect(mobile.has(t), `desktop-only route: ${t}`).toBe(true);
    }
  });
});
