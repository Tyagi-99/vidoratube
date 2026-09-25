/**
 * P7: Billing provider abstraction.
 *
 * Stripe (global/USD) and Razorpay (India/INR) sit behind one interface so
 * the UI and webhook handlers never touch provider specifics. Both adapters
 * use direct REST calls (no SDK) so webhook signature verification and API
 * calls are explicit, testable, and dependency-free.
 *
 * TEST MODE ONLY: adapters read test-mode keys from env. Going live is a
 * documented user action (docs/BILLING.md).
 */
import type { Currency, Plan } from "./plans";

export type BillingProviderName = "stripe" | "razorpay";

export interface CheckoutRequest {
  plan: Plan;
  currency: Currency;
  userId: string;
  userEmail: string;
  successUrl: string;
  cancelUrl: string;
}

/** What the UI needs to send the buyer to the provider. */
export interface CheckoutResult {
  provider: BillingProviderName;
  /** For Stripe: the hosted Checkout Session URL. */
  redirectUrl?: string;
  /** For Razorpay: order details the client SDK uses to open the modal. */
  razorpayOrder?: { orderId: string; amount: number; currency: string; keyId: string };
  purchaseRef: string;
}

export interface ProviderSubscription {
  externalId: string;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface BillingProvider {
  readonly name: BillingProviderName;
  /** True when the adapter's keys are present (test or live). */
  isConfigured(): boolean;
  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
  createCustomerPortalUrl(externalCustomerId: string, returnUrl: string): Promise<string>;
  cancelSubscription(externalSubscriptionId: string): Promise<void>;
  getSubscription(externalSubscriptionId: string): Promise<ProviderSubscription>;
}
