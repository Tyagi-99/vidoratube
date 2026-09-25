import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  cancelSubscription,
  createCheckout,
  createPortalSession,
  getBillingConfig,
  getBillingState,
} from "@/lib/billing.functions";
import { formatPrice, type Currency } from "@/lib/billing/plans";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Coins, CreditCard, XCircle } from "lucide-react";
import { ReferralSection } from "@/components/vidora/ReferralSection";

export const Route = createFileRoute("/_authenticated/billing/")({
  component: BillingPage,
  validateSearch: (s: Record<string, unknown>) => ({
    purchase: typeof s["purchase"] === "string" ? (s["purchase"] as string) : undefined,
  }),
});

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

function loadRazorpayScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Razorpay checkout"));
    document.body.appendChild(script);
  });
}

function BillingPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const search = useSearch({ from: "/_authenticated/billing/" });
  const [currency, setCurrency] = useState<Currency>("usd");

  const configFn = useServerFn(getBillingConfig);
  const stateFn = useServerFn(getBillingState);
  const checkoutFn = useServerFn(createCheckout);
  const cancelFn = useServerFn(cancelSubscription);
  const portalFn = useServerFn(createPortalSession);

  const config = useQuery({ queryKey: ["billing-config"], queryFn: () => configFn() });
  const state = useQuery({ queryKey: ["billing-state"], queryFn: () => stateFn() });

  useEffect(() => {
    if (search.purchase === "success") {
      toast.success(t("billing_purchase_success"));
      // The webhook grants credits; refresh after a beat.
      const id = setTimeout(() => queryClient.invalidateQueries({ queryKey: ["billing-state"] }), 4000);
      return () => clearTimeout(id);
    }
    if (search.purchase === "cancelled") toast.info(t("billing_purchase_cancelled"));
    return undefined;
  }, [search.purchase, t, queryClient]);

  const checkout = useMutation({
    mutationFn: (input: { planSlug: string; currency: Currency }) =>
      checkoutFn({ data: input }),
    onSuccess: async (result) => {
      if (result.redirectUrl) {
        // Stripe: hosted checkout.
        window.location.href = result.redirectUrl;
        return;
      }
      if (result.razorpayOrder) {
        // Razorpay: open the modal; the webhook grants credits on capture.
        try {
          await loadRazorpayScript();
          if (!window.Razorpay) throw new Error("Razorpay checkout failed to load.");
          const rzp = new window.Razorpay({
            key: result.razorpayOrder.keyId,
            order_id: result.razorpayOrder.orderId,
            amount: result.razorpayOrder.amount,
            currency: result.razorpayOrder.currency,
            name: "Vidora",
            theme: { color: "#7c3aed" },
            modal: {
              ondismiss: () => queryClient.invalidateQueries({ queryKey: ["billing-state"] }),
            },
          });
          rzp.open();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : t("billing_checkout_error"));
        }
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("billing_checkout_error")),
  });

  const cancel = useMutation({
    mutationFn: (subscriptionId: string) => cancelFn({ data: { subscriptionId } }),
    onSuccess: () => {
      toast.success(t("billing_cancelled"));
      queryClient.invalidateQueries({ queryKey: ["billing-state"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("billing_checkout_error")),
  });

  const portal = useMutation({
    mutationFn: () => portalFn({}),
    onSuccess: (r) => {
      window.location.href = r.url;
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("billing_checkout_error")),
  });

  const configured = Boolean(config.data?.stripe || config.data?.razorpay);
  // Default currency from the provider that's actually configured.
  const effectiveCurrency: Currency =
    currency === "inr" && !config.data?.razorpay
      ? "usd"
      : currency === "usd" && !config.data?.stripe && config.data?.razorpay
        ? "inr"
        : currency;

  useEffect(() => {
    // Pick a sane default once config loads.
    if (config.data && currency === "usd" && !config.data.stripe && config.data.razorpay) {
      setCurrency("inr");
    }
  }, [config.data, currency]);

  const subs = state.data?.subscriptions.filter((s) => s.status === "active" || s.status === "trialing") ?? [];
  const plans = state.data?.plans ?? [];
  const planRows = plans.filter((p) => p.kind === "subscription");
  const packRows = plans.filter((p) => p.kind === "pack");

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight">{t("billing_title")}</h1>
      <p className="mt-1 text-muted-foreground">{t("billing_subtitle")}</p>

      {state.isLoading ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Coins className="h-4 w-4" /> {t("billing_credits")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-4xl font-bold">{state.data?.credits ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CreditCard className="h-4 w-4" /> {t("billing_current_plan")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-semibold">
                  {subs.length > 0
                    ? (plans.find((p) => p.slug === subs[0]!.plan_slug)?.name ?? subs[0]!.plan_slug)
                    : t("billing_free_plan")}
                </p>
                {subs.length > 0 && subs[0]!.current_period_end && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t("billing_active_until")}{" "}
                    {new Date(subs[0]!.current_period_end).toLocaleDateString()}
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Currency</CardTitle>
              </CardHeader>
              <CardContent className="flex gap-2">
                <Button
                  variant={effectiveCurrency === "inr" ? "default" : "outline"}
                  size="sm"
                  disabled={!config.data?.razorpay}
                  onClick={() => setCurrency("inr")}
                >
                  ₹ INR
                </Button>
                <Button
                  variant={effectiveCurrency === "usd" ? "default" : "outline"}
                  size="sm"
                  disabled={!config.data?.stripe}
                  onClick={() => setCurrency("usd")}
                >
                  $ USD
                </Button>
              </CardContent>
            </Card>
          </div>

          {!configured && (
            <p className="mt-6 rounded-lg border border-dashed border-accent/40 px-4 py-3 text-sm">
              {t("billing_not_configured")}
            </p>
          )}

          {configured && planRows.length > 0 && (
            <section className="mt-10">
              <h2 className="text-xl font-semibold">{t("billing_plans")}</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {planRows.map((p) => (
                  <Card key={p.slug}>
                    <CardHeader>
                      <CardTitle>{p.name}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-3xl font-bold">
                        {formatPrice(
                          {
                            slug: p.slug,
                            name: p.name,
                            kind: "subscription",
                            credits: p.credits_granted,
                            interval: "month",
                            priceUsdCents: p.price_usd_cents,
                            priceInrPaise: p.price_inr_paise,
                          },
                          effectiveCurrency,
                        )}
                        <span className="text-base font-normal text-muted-foreground">
                          {t("billing_per_month")}
                        </span>
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {p.credits_granted} credits{t("billing_per_month")}
                      </p>
                      <Button
                        className="mt-4"
                        disabled={checkout.isPending}
                        onClick={() => checkout.mutate({ planSlug: p.slug, currency: effectiveCurrency })}
                      >
                        {t("billing_subscribe")}
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {configured && packRows.length > 0 && (
            <section className="mt-10">
              <h2 className="text-xl font-semibold">{t("billing_packs")}</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                {packRows.map((p) => (
                  <Card key={p.slug}>
                    <CardHeader>
                      <CardTitle>{p.name}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-2xl font-bold">
                        {formatPrice(
                          {
                            slug: p.slug,
                            name: p.name,
                            kind: "pack",
                            credits: p.credits_granted,
                            interval: "once",
                            priceUsdCents: p.price_usd_cents,
                            priceInrPaise: p.price_inr_paise,
                          },
                          effectiveCurrency,
                        )}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {p.credits_granted} credits · {t("billing_one_time")}
                      </p>
                      <Button
                        className="mt-4"
                        variant="outline"
                        disabled={checkout.isPending}
                        onClick={() => checkout.mutate({ planSlug: p.slug, currency: effectiveCurrency })}
                      >
                        {t("billing_buy")}
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {subs.length > 0 && (
            <section className="mt-10">
              <h2 className="text-xl font-semibold">Subscriptions</h2>
              <div className="mt-4 space-y-3">
                {subs.map((s) => (
                  <Card key={s.id}>
                    <CardContent className="flex items-center justify-between py-4">
                      <div>
                        <p className="font-medium">
                          {plans.find((p) => p.slug === s.plan_slug)?.name ?? s.plan_slug}
                          <span className="ml-2 text-sm text-muted-foreground">({s.provider})</span>
                        </p>
                        {s.cancel_at_period_end && (
                          <p className="text-sm text-muted-foreground">
                            {t("billing_active_until")}{" "}
                            {s.current_period_end
                              ? new Date(s.current_period_end).toLocaleDateString()
                              : "—"}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {s.provider === "stripe" && (
                          <Button variant="outline" size="sm" onClick={() => portal.mutate()}>
                            {t("billing_manage_payment")}
                          </Button>
                        )}
                        {!s.cancel_at_period_end && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            disabled={cancel.isPending}
                            onClick={() => {
                              if (window.confirm(t("billing_cancel_confirm"))) cancel.mutate(s.id);
                            }}
                          >
                            <XCircle className="mr-1 h-4 w-4" /> {t("billing_cancel_sub")}
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          <section className="mt-10">
            <h2 className="text-xl font-semibold">{t("billing_usage")}</h2>
            <Card className="mt-4">
              <CardContent className="p-0">
                {(state.data?.ledger ?? []).length === 0 ? (
                  <p className="px-4 py-6 text-sm text-muted-foreground">{t("billing_no_usage")}</p>
                ) : (
                  <ul className="divide-y">
                    {(state.data?.ledger ?? []).map((entry, i) => (
                      <li key={i} className="flex items-center justify-between px-4 py-3 text-sm">
                        <span className="text-muted-foreground">{entry.reason}</span>
                        <span className={entry.delta >= 0 ? "text-green-600" : "text-foreground"}>
                          {entry.delta >= 0 ? "+" : ""}
                          {entry.delta}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </section>
          <ReferralSection />
        </>
      )}
    </main>
  );
}
