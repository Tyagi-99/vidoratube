# Founder TODO

Things only the founder can do: external accounts, keys, legal info, domain,
and one VM deploy. Everything is built behind feature flags/stubs — nothing
below blocks development. Each item lists what, where to get it, how long it
takes, and what it unblocks.

## 1. Legal entity details
- **What:** Fill `entityName`, `registeredAddress`, `courtCity` in `src/config/legal.ts`
  (e.g. `"<Full legal name>, sole proprietor, trading as Vidora AI"`,
  `"Bengaluru, Karnataka, India"`, `"Bengaluru"`).
- **Where:** Your incorporation certificate / CA. If not incorporated yet, decide the
  structure (sole proprietor vs Pvt Ltd) with a CA first.
- **Time:** 30 min once decided (incorporation itself is weeks — start early).
- **Unblocks:** Terms show the real entity; "lawyer review pending" note in the repo
  can be cleared. Until then the site shows neutral wording ("Vidora AI", governing law India).

## 2. Grievance officer details
- **What:** Fill `grievanceName`, `grievanceEmail`, `grievancePostal` in `src/config/legal.ts`.
  The email MUST be on a domain you control.
- **Where:** Appoint someone (can be you initially). Needs a dedicated inbox.
- **Time:** 15 min.
- **Unblocks:** Privacy page shows the officer's name/email/address with statutory
  timelines instead of linking the /contact form. (Timelines are cited in a code
  comment on the Privacy page — get a lawyer to confirm before launch.)

## 3. Dodo Payments live keys (USD)
- **What:** Create a Dodo Payments (Merchant of Record) account, complete KYC, and add
  `DODO_API_KEY` + `DODO_WEBHOOK_SECRET` to Lovable Cloud Secrets.
- **Where:** https://dodopayments.com dashboard → Developers → API keys / Webhooks.
  Configure the webhook URL to `https://vidoratube.lovable.app/api/webhooks/dodo`.
- **Time:** 1–2 days (account approval + KYC).
- **Unblocks:** USD checkout switches on automatically (`paymentsLive` flag). Until then
  checkout buttons show "Coming soon".

## 4. Razorpay live keys (INR)
- **What:** Create a Razorpay account, complete KYC, and add `RAZORPAY_KEY_ID`,
  `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` to Lovable Cloud Secrets.
- **Where:** https://dashboard.razorpay.com → Settings → API Keys / Webhooks.
  Webhook URL: `https://vidoratube.lovable.app/api/webhooks/razorpay`.
- **Time:** 2–5 days (Indian business KYC).
- **Unblocks:** INR checkout switches on automatically. Until then "Coming soon".

## 5. Domain decision: vidora.ai
- **What:** Decide whether you own (or will buy) `vidora.ai`.
  - If YES: point DNS to Lovable (custom domain setup in the Lovable dashboard),
    then tell the team so `hello@vidora.ai` becomes a real monitored inbox.
  - If NO: stay on `vidoratube.lovable.app`. Per the current instruction the
    `hello@vidora.ai` address stays as-is until you configure this — but emails
    to it go nowhere (or to whoever owns the domain), so decide soon.
- **Where:** Your registrar (e.g. Namecheap/Cloudflare) or buy the domain.
- **Time:** 15 min to check ownership; DNS cutover ~1 hour + propagation.
- **Unblocks:** Real customer/billing email; custom domain for the marketing site.

## 6. Render worker deploy (Oracle Cloud VM)
- **What:** From your laptop, repo root, with `.env` filled in (copy from root
  `.env.example`):
  `WORKER_HOST=ubuntu@<oracle-ip> ./scripts/deploy-worker.sh`
  It builds the worker image, ships it to the host, and starts it with
  `docker compose`. Needs a VM with ≥4 vCPU / 16 GB RAM.
- **Where:** Oracle Cloud free/paid VM (Ubuntu 22.04+). One-time host setup:
  install Docker Engine + compose plugin, add your SSH user to the docker group
  (see `worker/README.md`).
- **Time:** ~30 min (mostly Docker install + image build).
- **Unblocks:** Server-side rendering (close-the-tab renders, multi-aspect output,
  realtime progress). Until deployed, the app automatically falls back to the
  in-browser FFmpeg.wasm render path.

## 7. Connect a YouTube TEST channel
- **What:** Create (or designate) a throwaway YouTube channel for integration testing
  and connect it in the app's YouTube settings. NEVER connect a real channel until
  the safety/approval flow is verified.
- **Where:** YouTube → new channel; Google Cloud Console OAuth client (docs/GOOGLE_VERIFICATION.md).
- **Time:** 30 min (+ Google OAuth verification is a separate multi-week track).
- **Unblocks:** End-to-end publish testing through the real YouTube API.

## 8. Email users about the credit → minute migration
- **What:** After the `20260925194000_per_minute_credits` migration is applied,
  email every user who had a positive balance: "Your N credits are now N finished
  minutes (1:1). Nothing was taken; failed renders now refund automatically."
- **Where:** Your email tool (or the app's future notification system). The affected
  user list: `select user_id from credit_ledger where reason like 'migration_per_minute%'`.
- **Time:** 20 min to send (pre-launch this is likely a handful of test accounts).
- **Unblocks:** Trust — users should hear about unit changes from you, not discover
  them on the pricing page.

## 9. Apply the two new Supabase migrations
- **What:** Apply `supabase/migrations/20260925194000_per_minute_credits.sql`
  (minute-based debit/refund RPCs + append-only conversion entries) and
  `supabase/migrations/20260925195000_pricing_inr.sql` (`pricing_plans.price_monthly_inr`).
- **Where:** Supabase SQL editor or `supabase db push`. Both are non-destructive
  (new functions, one new nullable column, insert-only ledger rows).
- **Time:** 10 min. Verify: `select * from credit_ledger where reason like
  'migration_per_minute%' limit 5;` and the pricing page toggle.
- **Unblocks:** Per-minute charging and INR pricing in production.
