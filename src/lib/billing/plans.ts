/**
 * P7: Billing plan catalog (client-safe mirror of the `plans` table seed).
 * Server functions should read prices from the DB; this mirror is for UI
 * display and for tests. Do not over-claim: these are the launch defaults.
 */

export type PlanKind = "subscription" | "pack";
export type Currency = "inr" | "usd";

export interface Plan {
  slug: string;
  name: string;
  kind: PlanKind;
  credits: number;
  interval: "once" | "month";
  priceUsdCents: number | null;
  priceInrPaise: number | null;
}

export const PLANS: Plan[] = [
  { slug: "creator", name: "Creator", kind: "subscription", credits: 60, interval: "month", priceUsdCents: 1900, priceInrPaise: 159900 },
  { slug: "studio", name: "Studio", kind: "subscription", credits: 200, interval: "month", priceUsdCents: 4900, priceInrPaise: 409900 },
  { slug: "pack_s", name: "Starter pack", kind: "pack", credits: 25, interval: "once", priceUsdCents: 900, priceInrPaise: 74900 },
  { slug: "pack_m", name: "Growth pack", kind: "pack", credits: 70, interval: "once", priceUsdCents: 1900, priceInrPaise: 159900 },
  { slug: "pack_l", name: "Scale pack", kind: "pack", credits: 200, interval: "once", priceUsdCents: 4900, priceInrPaise: 409900 },
];

export function getPlan(slug: string): Plan | undefined {
  return PLANS.find((p) => p.slug === slug);
}

/** Format a price for display. INR uses paise, USD uses cents. */
export function formatPrice(plan: Plan, currency: Currency): string {
  if (currency === "inr") {
    if (plan.priceInrPaise == null) return "—";
    const rupees = plan.priceInrPaise / 100;
    return `₹${rupees.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  }
  if (plan.priceUsdCents == null) return "—";
  const dollars = plan.priceUsdCents / 100;
  return `$${dollars.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/** Default currency: INR for India (user is Hindi-first), USD elsewhere. */
export function defaultCurrency(countryCode?: string | null): Currency {
  return countryCode?.toUpperCase() === "IN" ? "inr" : "usd";
}
