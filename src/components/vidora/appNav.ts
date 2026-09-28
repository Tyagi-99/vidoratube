/**
 * Single source of truth for the authenticated app's top navigation.
 * Every top-level feature route MUST appear here — orphan routes (a page
 * with no nav entry) are invisible to users. See `appNav.test.ts`.
 */

export type NavRoute =
  | "/studio"
  | "/projects"
  | "/publish"
  | "/agent"
  | "/research"
  | "/create"
  | "/thumbnails"
  | "/characters"
  | "/intelligence"
  | "/analytics"
  | "/experiments"
  | "/learnings"
  | "/comments"
  | "/agency"
  | "/billing"
  | "/settings/api-keys";

export type NavItem = { label: string; to: NavRoute };

/** Always-visible top-level links (desktop). */
export const directLinks: NavItem[] = [
  { label: "Studio", to: "/studio" },
  { label: "Projects", to: "/projects" },
  { label: "Publish", to: "/publish" },
  { label: "Agent", to: "/agent" },
];

/** Grouped dropdown menus (desktop). */
export const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Create",
    items: [
      { label: "Research", to: "/research" },
      { label: "Create", to: "/create" },
      { label: "Thumbnails", to: "/thumbnails" },
      { label: "Characters", to: "/characters" },
    ],
  },
  {
    label: "Grow",
    items: [
      { label: "Intelligence", to: "/intelligence" },
      { label: "Analytics", to: "/analytics" },
      { label: "Experiments", to: "/experiments" },
      { label: "Learnings", to: "/learnings" },
      { label: "Comments", to: "/comments" },
    ],
  },
  {
    label: "Workspace",
    items: [
      { label: "Agency", to: "/agency" },
      { label: "Billing", to: "/billing" },
      { label: "Settings", to: "/settings/api-keys" },
    ],
  },
];

/** Flat list for the mobile menu (vertical — no overflow concern). */
export const mobileLinks: NavItem[] = [...directLinks, ...navGroups.flatMap((g) => g.items)];

/** Every nav target, for reachability checks. */
export const allNavTargets: NavRoute[] = mobileLinks.map((i) => i.to);
