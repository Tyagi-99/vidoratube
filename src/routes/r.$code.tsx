import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { isValidReferralCode } from "@/lib/referrals";

/**
 * /r/{code} — invite landing. Stashes the code in localStorage and sends
 * the visitor to signup. After they verify their email, useReferralClaim
 * submits the stored code for the reward.
 */
export const Route = createFileRoute("/r/$code")({
  beforeLoad: ({ params }) => {
    if (!isValidReferralCode(params.code)) {
      throw redirect({ to: "/", replace: true });
    }
  },
  component: ReferralLanding,
});

function ReferralLanding() {
  const { code } = Route.useParams();

  useEffect(() => {
    try {
      localStorage.setItem("vidora-referral-code", code);
    } catch {
      // ignore
    }
    window.location.href = "/auth?next=%2Fstudio";
  }, [code]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <p className="text-sm text-muted-foreground">Taking you to Vidora…</p>
    </div>
  );
}
