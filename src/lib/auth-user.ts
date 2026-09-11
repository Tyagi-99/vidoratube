/** A real account — not a missing session and not a silent anonymous guest. */
export function isAppUser(user: { is_anonymous?: boolean } | null | undefined): boolean {
  return Boolean(user && user.is_anonymous !== true);
}

export function locationToNext(location: {
  pathname: string;
  searchStr?: string;
  search?: Record<string, unknown>;
}): string {
  if (location.searchStr && location.searchStr !== "?") {
    return `${location.pathname}${location.searchStr}`;
  }
  const create = location.search?.["create"];
  if (typeof create === "string" && create.length > 0) {
    return `${location.pathname}?create=${encodeURIComponent(create)}`;
  }
  return location.pathname;
}

/** In-app path after login. Rejects protocol-relative and off-site URLs. */
export function safeAuthNext(raw: unknown): string {
  if (typeof raw !== "string") return "/studio";
  const next = raw.trim();
  if (!next.startsWith("/")) return "/studio";
  if (next.startsWith("//") || next.includes("://")) return "/studio";
  if (next === "/auth" || next.startsWith("/auth?") || next.startsWith("/auth#")) return "/studio";
  return next.slice(0, 200);
}
