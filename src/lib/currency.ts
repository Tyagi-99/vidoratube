/**
 * Currency detection + formatting (Sprint 0).
 *
 * USD is the global default. INR is shown only for Indian visitors, detected
 * best-effort from the CDN country header (Lovable runs on Cloudflare
 * Workers, so cf-ipcountry comes first), or when the visitor picks INR with
 * the manual toggle. Unknown/missing country -> USD.
 */

export type DisplayCurrency = "USD" | "INR";

const COUNTRY_HEADERS = [
  "cf-ipcountry", // Cloudflare (Lovable hosting)
  "x-vercel-ip-country",
  "x-appengine-country",
  "cloudfront-viewer-country",
  "x-country-code",
];

/** Pure: pick a currency from request headers. Unknown -> USD. */
export function detectCurrencyFromHeaders(
  get: (name: string) => string | null | undefined,
): DisplayCurrency {
  for (const name of COUNTRY_HEADERS) {
    const value = get(name);
    if (value) return value.trim().toUpperCase() === "IN" ? "INR" : "USD";
  }
  return "USD";
}

export function formatMoney(currency: DisplayCurrency, amount: number): string {
  if (currency === "INR") {
    return `₹${Math.round(amount).toLocaleString("en-IN")}`;
  }
  return `$${amount.toFixed(amount % 1 === 0 ? 0 : 2)}`;
}
