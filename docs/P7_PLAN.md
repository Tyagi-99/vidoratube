# P7 Plan: Billing & Payments

## Goal
Turn credits into revenue: real checkout, subscriptions, credit packs, INR +
USD pricing, and per-minute server-render billing (deferred from P2).

## Why
The pricing page currently says checkout is not live. P1 built the credit
ledger and debits; P7 connects money. This is what makes it a business.

## Scope

### 1. Payment providers
- **Stripe** (global, USD): subscriptions + one-time credit packs
- **Razorpay** (India, INR): subscriptions + one-time — user is English-first,
  India is a primary market
- Provider abstraction: `src/lib/billing/providers.ts` — Stripe | Razorpay
  behind one interface (createCheckout, handleWebhook, etc.)
- Webhook handlers with signature verification, idempotent event processing

### 2. Plans & pricing
- Free: 10 credits on verified signup (existing P1)
- Creator: monthly credits, INR + USD prices
- Studio: higher tier
- Credit packs: one-time top-ups (small/medium/large)
- Pricing page updated: real checkout buttons, honest "coming soon" removed

### 3. Subscription lifecycle
- `subscriptions` table: user_id, provider, plan, status, current_period_end
- Webhook events: created/renewed/canceled/past_due → grant monthly credits
- Cancel flow in billing settings; prorations per provider defaults

### 4. Server-render billing (P2 deferred)
- Per-minute billing for server renders: track render duration, debit
  credits per started minute (rate from plan config)
- Reserve → render → actual-cost record → commit/refund pattern

### 5. Billing UI
- `/billing` route: current plan, credits balance, usage history, invoices
- Checkout: provider-aware (Stripe vs Razorpay by currency/region)
- Payment method management via provider portals

### 6. Ledger integrity
- All grants/debits through existing idempotent RPCs
- `billing_events` table: raw webhook events (audit trail)
- Reconciliation: nightly job sketch (document; implement if time)

## Data model (migration)
- `subscriptions` (id, user_id, provider, external_id, plan, status, period_end)
- `billing_events` (id, provider, event_id, type, payload JSONB, processed_at)
- `plans` (id, name, credits_monthly, price_inr, price_usd, interval)
- Render cost columns on `renders` (billed_minutes, credits_charged)

## Constraints
- Test mode first: Stripe test keys, Razorpay test mode — NO live charges in dev
- Webhook signature verification mandatory
- Idempotency: same event never grants twice
- PCI: never touch card numbers — provider-hosted checkout only
- i18n en/hi, INR formatting (₹) + USD ($)

## Deliverables
1. Migration(s)
2. Provider abstraction + Stripe/Razorpay adapters
3. Webhook handlers (signature-verified, idempotent)
4. Subscription lifecycle functions
5. Per-minute render billing
6. /billing UI + pricing page checkout
7. Tests: webhook idempotency, lifecycle transitions, render cost math
8. `docs/BILLING.md`: provider setup, test cards, go-live checklist
9. CHANGELOG entry

## Verification
- tsc clean, vitest green, build clean
- Webhook replay → no double-grant (test)
- Render cost math fixtures
- Go-live checklist reviewed

## Genuine blockers (user-side)
- Stripe account creation + API keys
- Razorpay account creation + API keys (India business docs)
- Switching from test to live mode
