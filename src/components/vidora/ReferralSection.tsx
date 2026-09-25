import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Check, Users } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { getMyReferralLink, listMyReferrals } from "@/lib/referrals.functions";
import { REFERRAL_REWARD_CREDITS } from "@/lib/referrals";
import { Button } from "@/components/ui/button";

/** Invite friends → both sides earn credits on email verification. */
export function ReferralSection() {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const linkFn = useServerFn(getMyReferralLink);
  const listFn = useServerFn(listMyReferrals);

  const link = useQuery({ queryKey: ["referral-link"], queryFn: () => linkFn() });
  const referrals = useQuery({ queryKey: ["referrals"], queryFn: () => listFn() });

  const copy = async () => {
    if (!link.data?.link) return;
    try {
      await navigator.clipboard.writeText(link.data.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — user can select the text manually
    }
  };

  const rows = referrals.data ?? [];
  const rewarded = rows.filter((r) => r.status === "rewarded").length;

  return (
    <section className="mt-10" aria-labelledby="referral-heading">
      <h2 id="referral-heading" className="flex items-center gap-2 text-xl font-semibold">
        <Users className="size-5" aria-hidden="true" /> {t("referral_title")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("referral_subtitle")}
      </p>

      <div className="mt-4 flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("referral_your_link")}
          </div>
          <div className="mt-1 truncate font-mono text-sm">
            {link.isLoading ? "…" : link.data?.link ?? "—"}
          </div>
        </div>
        <Button onClick={copy} disabled={!link.data?.link} className="gap-2">
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? t("referral_copied") : t("referral_copy")}
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-2xl font-bold tabular-nums">{rows.length}</div>
          <div className="text-xs text-muted-foreground">{t("referral_invited")}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-2xl font-bold tabular-nums">{rewarded}</div>
          <div className="text-xs text-muted-foreground">{t("referral_rewarded")}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-2xl font-bold tabular-nums">{rewarded * REFERRAL_REWARD_CREDITS}</div>
          <div className="text-xs text-muted-foreground">{t("referral_earned")}</div>
        </div>
      </div>

      {rows.length === 0 && !referrals.isLoading && (
        <p className="mt-4 text-sm text-muted-foreground">{t("referral_no_invites")}</p>
      )}
    </section>
  );
}
