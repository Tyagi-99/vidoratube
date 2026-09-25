import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { submitPendingReferral } from "@/lib/referrals.functions";
import { getDeviceHash } from "@/lib/device";
import { isValidReferralCode } from "@/lib/referrals";
import { useSession } from "./useSession";

/**
 * After a verified user lands in the app, submit any stored referral code
 * exactly once. Runs when the session becomes available; the server guards
 * all the rest (self-referral, duplicates, farming clusters).
 */
export function useReferralClaim() {
  const { user, loading } = useSession();
  const attempted = useRef(false);
  const submitFn = useServerFn(submitPendingReferral);

  useEffect(() => {
    if (loading || !user || attempted.current) return;
    if (!user.email_confirmed_at && user.app_metadata?.provider !== "google") return;
    attempted.current = true;

    let code: string | null = null;
    try {
      code = localStorage.getItem("vidora-referral-code");
      localStorage.removeItem("vidora-referral-code");
    } catch {
      // ignore
    }
    if (!code || !isValidReferralCode(code)) return;

    submitFn({ data: { code, deviceHash: getDeviceHash() || undefined } }).catch(() => {
      // Silent: claiming is best-effort; the server records nothing on failure.
    });
  }, [user, loading, submitFn]);
}
