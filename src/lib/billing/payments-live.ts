/**
 * paymentsLive feature flag.
 *
 * Checkout buttons show "Coming soon" until the provider's keys exist in
 * secrets. The moment the founder adds live keys (docs/FOUNDER_TODO.md),
 * checkout switches on automatically — no code change, no redeploy needed
 * beyond the secret itself.
 */
import { isDodoConfigured } from "./dodo";
import { isRazorpayConfigured } from "./razorpay";

export interface PaymentsLive {
  /** Dodo Payments (USD). Requires DODO_API_KEY + DODO_WEBHOOK_SECRET. */
  dodo: boolean;
  /** Razorpay (INR). Requires RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET. */
  razorpay: boolean;
  /** Any provider ready to take checkout. */
  any: boolean;
}

export function paymentsLive(): PaymentsLive {
  const dodo = isDodoConfigured();
  const razorpay = isRazorpayConfigured();
  return { dodo, razorpay, any: dodo || razorpay };
}
