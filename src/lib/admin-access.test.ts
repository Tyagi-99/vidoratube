import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ADMIN_FORBIDDEN_COPY, resolveAdminAccessState } from "./admin-access";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("resolveAdminAccessState", () => {
  it("grants access only on an explicit isAdmin: true", () => {
    expect(
      resolveAdminAccessState({ isLoading: false, isError: false, isAdmin: true }),
    ).toBe("allowed");
  });

  it("renders the 403 state for non-admins", () => {
    expect(
      resolveAdminAccessState({ isLoading: false, isError: false, isAdmin: false }),
    ).toBe("forbidden");
  });

  it("fails closed when the admin flag is missing", () => {
    expect(
      resolveAdminAccessState({ isLoading: false, isError: false, isAdmin: undefined }),
    ).toBe("forbidden");
    expect(
      resolveAdminAccessState({ isLoading: false, isError: false, isAdmin: null }),
    ).toBe("forbidden");
  });

  it("loading and error take precedence", () => {
    expect(
      resolveAdminAccessState({ isLoading: true, isError: false, isAdmin: false }),
    ).toBe("loading");
    expect(
      resolveAdminAccessState({ isLoading: false, isError: true, isAdmin: true }),
    ).toBe("error");
  });
});

describe("403 copy leaks nothing sensitive", () => {
  it("mentions no account identifiers or admin roster hints", () => {
    const copy = `${ADMIN_FORBIDDEN_COPY.title} ${ADMIN_FORBIDDEN_COPY.subtitle} ${ADMIN_FORBIDDEN_COPY.body}`;
    expect(copy).toContain("Access denied");
    expect(copy).not.toMatch(/@/); // no emails
    expect(copy).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i); // no ids
    expect(copy.toLowerCase()).not.toContain("contact");
  });
});

describe("S2 regression: admin route renders a 403 instead of redirecting", () => {
  const src = read("src/routes/_authenticated/admin.tsx");

  it("no longer client-side redirects non-admins to /studio", () => {
    expect(src).not.toContain("useNavigate");
    expect(src).not.toMatch(/navigate\(\{\s*to:\s*"\/studio"/);
  });

  it("wires the forbidden state to the 403 panel", () => {
    expect(src).toContain("resolveAdminAccessState");
    expect(src).toContain("ADMIN_FORBIDDEN_COPY");
    expect(src).toContain("forbidden");
    expect(src).toContain("Back to studio");
  });
});
