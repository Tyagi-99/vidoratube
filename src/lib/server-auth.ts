import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * requireSupabaseAuth + rejection of Supabase anonymous guests.
 *
 * The generated auth-middleware (which must not be edited directly) accepts any
 * valid JWT, including anonymous sessions. Anonymous users have no profile row
 * and no credits, so they must fail closed on every authenticated endpoint
 * instead of falling through to confusing "not found" errors — or worse, a
 * future profile-less endpoint that would treat them as real users.
 */
export const requireAppUser = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const claims = (context as { claims?: { is_anonymous?: boolean } }).claims;
    if (claims?.is_anonymous) {
      throw new Error("Unauthorized: anonymous sessions are not permitted");
    }
    return next();
  });
