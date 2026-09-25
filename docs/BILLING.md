# Billing & Payments (P7)

Vidora sells **credits** through two providers:

| Provider | Currency | Products | Keys |
|----------|----------|----------|------|
| **Stripe** | USD (global) | Subscriptions + one-time credit packs | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| **Razorpay** | INR (India) | One-time credit packs (subscriptions: planned, see below) | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` |

Card data never touches our servers — both flows use provider-hosted checkout
(Stripe Checkout Sessions, Razorpay Checkout modal).

## Architecture

```
buyer → createCheckout(plan, currency) → provider checkout
                                              ↓ paid
provider → POST /api/webhooks/{stripe|razorpay}
              1. verify signature (HMAC-SHA256, throws on failure)
              2. claimBillingEvent() — INSERT into billing_events;
                 UNIQUE(provider, event_id) makes replays no-ops
              3. normalize → processDomainEvent()
              4. grant_credits_once() — idempotent grant (deterministic ref)
```

### Domain events

- `purchase.completed` → grant pack credits once.
- `subscription.renewed` → upsert `subscriptions` row + grant monthly credits.
- `subscription.ended` → mark subscription canceled/halted.

### Server-render billing (per-minute)

1. `enqueueServerRender` reserves 10 minutes via `debit_credits_amount_once`
   (idempotent per render id) **before** the job row is created.
2. The worker calls `finalize_render_billing(render_id)` on completion:
   actual started minutes (min 1) are settled against the reserve —
   overage debits the difference, under-use refunds it.
3. `renders.billed_minutes` / `credits_charged` record the outcome.
   The RPC is idempotent (a second call is a no-op).

## Setup — Stripe (test mode)

1. Create an account at https://dashboard.stripe.com and stay in **Test mode**.
2. Developers → API keys → copy the **Secret key** (`sk_test_…`) →
   Lovable Cloud secret `STRIPE_SECRET_KEY`.
3. Developers → Webhooks → Add endpoint:
   `https://<your-domain>/api/webhooks/stripe`
   Events: `checkout.session.completed`, `invoice.payment_succeeded`,
   `customer.subscription.updated`, `customer.subscription.deleted`.
4. Copy the **Signing secret** (`whsec_…`) → `STRIPE_WEBHOOK_SECRET`.
5. Test card: `4242 4242 4242 4242`, any future expiry, any CVC.

## Setup — Razorpay (test mode)

1. Create an account at https://dashboard.razorpay.com (test mode is on by default).
2. Settings → API Keys → generate → `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`.
3. Settings → Webhooks → Add: `https://<your-domain>/api/webhooks/razorpay`
   Events: `payment.captured`, `subscription.charged`, `subscription.cancelled`,
   `subscription.halted`. Copy the webhook secret → `RAZORPAY_WEBHOOK_SECRET`.
4. Test with Razorpay's test cards/UPI in test mode.

> **Razorpay subscriptions** are not wired yet: `razorpayProvider.createCheckout`
> throws a clear error for subscription plans until a Razorpay plan id is
> created in the dashboard and stored on the plan row (`razorpay_plan_id`).
> INR buyers can use credit packs today, or pay USD via Stripe.

## Plans (seeded by migration)

| Slug | Type | Credits | USD | INR |
|------|------|---------|-----|-----|
| creator | subscription/month | 60 | $19 | ₹1,599 |
| studio | subscription/month | 200 | $49 | ₹4,099 |
| pack_s | one-time | 25 | $9 | ₹749 |
| pack_m | one-time | 70 | $19 | ₹1,599 |
| pack_l | one-time | 200 | $49 | ₹4,099 |

Edit prices in the `plans` table; the UI reads them from `getBillingState`.

## Go-live checklist

- [ ] Stripe account: switch off test mode, replace `STRIPE_SECRET_KEY` with `sk_live_…`,
      create a **new** webhook endpoint (live mode has separate secrets).
- [ ] Razorpay: complete KYC, switch to live mode, rotate keys/secrets.
- [ ] Set `SITE_URL` to the production domain (used for checkout success/cancel URLs).
- [ ] Run a real ₹1 / $1 test purchase in live mode, then refund it.
- [ ] Replay a webhook from the provider dashboard; confirm `billing_events`
      dedupes it (`deduped: true`) and the balance doesn't move twice.
- [ ] Confirm a subscription renewal grants exactly one month of credits.

## Reconciliation

`billing_events` is the audit trail: every webhook is stored raw with
`processed_at` set on success. Events with `processed_at IS NULL` failed
processing — investigate and let the provider retry (retries are safe).
