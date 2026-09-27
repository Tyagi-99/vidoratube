/**
 * Admin console access-state resolution (S2 remediation).
 *
 * The admin shell used to redirect non-admins client-side
 * (`navigate("/studio")`); it now renders a real inline 403 panel instead.
 * The real gate is unchanged: every admin server function enforces
 * `assertAdmin` server-side. This module only decides which shell state to
 * render, so it is pure and unit-testable.
 */

export type AdminAccessState = "loading" | "error" | "forbidden" | "allowed";

/**
 * Map the account query state to a shell state. Fail-closed: only an
 * explicit `isAdmin: true` grants access — undefined/null (e.g. a
 * partially-loaded or unexpected payload) resolves to "forbidden", never
 * to "allowed".
 */
export function resolveAdminAccessState(args: {
  isLoading: boolean;
  isError: boolean;
  isAdmin: boolean | undefined | null;
}): AdminAccessState {
  if (args.isLoading) return "loading";
  if (args.isError) return "error";
  if (args.isAdmin === true) return "allowed";
  return "forbidden";
}

/**
 * 403 panel copy. Deliberately reveals nothing sensitive: no account email,
 * no user id, no hint about who the admins are or how to become one.
 */
export const ADMIN_FORBIDDEN_COPY = {
  title: "Access denied",
  subtitle: "Admin only",
  body: "This area is restricted to Vidora AI admins. If you need access, ask an administrator.",
} as const;
