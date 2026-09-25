/**
 * P7: Billing provider abstraction.
 *
 * Dodo Payments (USD, Merchant of Record) and Razorpay (India/INR) sit behind
 * one interface so the UI and webhook handlers never touch provider specifics.
 * Both adapters use direct REST calls (no SDK) so webhook signature
 * verification and API calls are explicit, testable, and dependency-free.
 *
 * Stripe is NOT approved but stays in the type union: adding it later means
 * writing one stripe.ts adapter implementing BillingProvider — no
 * business-logic changes.
 *
 * TEST MODE ONLY: adapters read test-mode keys from env. Going live is a
 * documented founder action (docs/FOUNDER_TODO.md).
 */
import type { Currency, Plan } from "./plans";

export type BillingProviderName = "dodo" | "razorpay" | "stripe";

export interface CheckoutRequest {
  plan: Plan;
  currency: Currency;
  userId: string;
  userEmail: string;
  successUrl: string;
  cancelUrl: string;
}

/** For Dodo: the hosted checkout URL. For Razorpay: order details the client SDK uses. */
export interface CheckoutResult {
  provider: BillingProviderName;
  /** For Dodo/Stripe: the hosted checkout URL. */
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
  /** Resolve the provider's customer id for a subscription (portal support). */
  getCustomerIdForSubscription(externalSubscriptionId: string): Promise<string>;
}
