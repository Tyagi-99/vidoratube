# Decisions

Non-obvious decisions made under autopilot (Investor Reply #3: "Decide, don't
ask"). Each entry: decision, reason, how to reverse. Newest first.

## 2026-09-25 — Sprint 0 remainder

### D1. Dodo Payments for USD, Razorpay for INR; Stripe kept in types only
- **Decision:** Checkout routing is USD → Dodo, INR → Razorpay. `BillingProviderName`
  still includes `stripe`, and the Stripe adapter file stays, but nothing routes to it.
- **Reason:** Investor Reply #3 mandates Dodo (USD) + Razorpay (INR) and explicitly
  says Stripe is not approved. Keeping the type union means Stripe can return with
  a single adapter file and zero logic changes if approval ever comes.
- **Reverse:** Add a `stripe.ts` adapter implementing `BillingProvider`, return it from
  `getBillingProvider("stripe")`, and route a currency to it in `billing.functions.ts`.

### D2. Checkout buttons show "Coming soon" until keys exist (paymentsLive)
- **Decision:** `paymentsLive()` reports per-provider liveness from env vars only
  (Dodo: API key + webhook secret; Razorpay: key id + key secret + webhook secret).
  Buttons render "Coming soon" and stay disabled until the matching provider is live;
  they switch on automatically when secrets land — no code change, no redeploy flag.
- **Reason:** Public copy may only promise what a logged-out stranger can use now.
  Auto-enable avoids a second deploy the day keys are added.
- **Reverse:** Change the button labels/conditions in `PricingSection.tsx` and
  `_authenticated/billing.index.tsx`.

### D3. Dodo via direct REST, no SDK
- **Decision:** `src/lib/billing/dodo.ts` calls Dodo's REST API with fetch; no
  `dodopayments` npm package.
- **Reason:** One less dependency and no SDK version drift for the three endpoints we
  need (checkout session, customer portal, subscription cancel/get). Webhook
  verification follows the Standard Webhooks scheme Dodo documents (HMAC-SHA256 over
  `{id}.{timestamp}.{body}`, `v1,` signatures, 5-minute replay tolerance).
- **Reverse:** `npm i dodopayments` and reimplement the adapter against the SDK.

### D4. AI hero shots billed at 1 credit per 10 seconds, totals rounded up
- **Decision:** The investor priced "AI hero shots billed per-second" without a rate.
  Set 1 credit per 10 seconds (rounded up); all multiplier totals round UP to whole
  credits since the ledger stores integers.
- **Reason:** Needed a concrete rate to ship per-minute billing; 10s/credit keeps a
  30-second hero montage at 3 credits — material but not punitive. Rounding up is the
  standard billing direction and keeps the ledger integer.
- **Reverse:** Change `aiHeroCredits()` in `src/lib/billing/per-minute.ts`.

### D5. Mode 2/3 voiceover flows keep the old per-project debit (deprecated shim)
- **Decision:** `debitOneCreditForProject` remains for the Mode 2/3 voiceover/script
  flows; only the video-render path moved to per-minute.
- **Reason:** Sprint 0 item 4 scopes the change to per-render charging. Voiceover
  projects produce audio, not finished video minutes; repricing them is a Sprint 1–2
  pricing decision, not a migration.
- **Reverse:** Route mode2/mode3 through `debitMinutesForJob` with a minutes model
  for audio, then delete the shim.

### D6. Thumbnail/safety micro-actions stay 1 credit per action
- **Decision:** `publish.functions.ts` (thumbnails/SEO) and `safety.functions.ts`
  (deep review/rewrites) keep charging 1 credit per AI action.
- **Reason:** Same scoping as D5 — these are per-AI-action charges, not per-render
  charges. Folding LLM micro-actions into per-minute video pricing needs a pricing
  decision, not a migration.
- **Reverse:** Price them in fractions via a decimal ledger or a separate quota.

### D7. INR price anchors for the current catalog
- **Decision:** Starter $19 → ₹1,599; Studio $49 → ₹3,999; Scale $149 → ₹11,999
  (migration `20260925195000_pricing_inr.sql`).
- **Reason:** Honest, India-friendly price points near the investor's own anchors
  (₹999/$12, ₹2,499/$29). Unknown slugs fall back to `ROUND(usd * 83.2)`.
- **Reverse:** Update `pricing_plans.price_monthly_inr` rows directly (admin SQL).

### D8. Currency detection: USD default, cf-ipcountry first, manual toggle wins
- **Decision:** `detectCurrencyFromHeaders` checks `cf-ipcountry` → `x-vercel-ip-country` →
  `x-appengine-country` → `cloudfront-viewer-country` → `x-country-code`; INR only for
  `IN`, everything else (including unknown) → USD. The visitor's manual toggle is
  stored in localStorage and overrides detection.
- **Reason:** Lovable hosts on Cloudflare Workers, so `cf-ipcountry` is the reliable
  signal in production. Unknown → USD is the investor's rule. The toggle respects
  the visitor (e.g. an Indian user on a VPN).
- **Reverse:** Reorder `COUNTRY_HEADERS` or change the default in `src/lib/currency.ts`.

### D9. Credit conversion as delta-0 documentary ledger entries
- **Decision:** Migration `20260925194000_per_minute_credits.sql` writes one
  `credit_ledger` row per user with a positive balance: `delta = 0`,
  `reason = 'migration_per_minute: converted N legacy credit(s) to N finished
  minute(s) at 1:1 …'`. Balances are untouched; no old rows edited or deleted.
  Idempotent via `NOT EXISTS`.
- **Reason:** 1 old credit → 1 minute is a 1:1 unit rename, so the honest record is
  documentary, not a balance movement. Append-only satisfies the investor's
  constraint and preserves the full audit trail.
- **Reverse:** Nothing to reverse in data (no balances changed). To rescind the
  labeling, delete rows with `reason LIKE 'migration_per_minute%'` — but that would
  break the append-only audit guarantee, so prefer leaving them.

### D10. FAQ JSON-LD lives inside FaqSection (SSR, 1:1 with visible copy)
- **Decision:** The `FAQPage` script tag is rendered by `FaqSection` itself from the
  same `faqs` array as the visible accordion, on both `/` and `/pricing`.
- **Reason:** Guarantees the structured data can never drift from the visible
  answers, and it ships in the initial server-rendered HTML (no client-only loading).
- **Reverse:** Move the script to route `head` and maintain a separate copy (not
  recommended — drift risk).

### D11. Worker deploys as a tarball over SSH — no container registry
- **Decision:** `scripts/deploy-worker.sh` builds the image locally, `docker save`s it
  to a tarball, `scp`s it to the Oracle host, and `docker load`s it there.
- **Reason:** No registry account, credentials, or retention policy to manage for a
  single-host deploy. One command, fully reproducible.
- **Reverse:** Push to GHCR/Docker Hub in the script and `docker compose pull` on
  the host instead.

### D12. Server-worker availability = heartbeat in renders within 15 minutes
- **Decision:** `getServerWorkerStatus` returns available=true iff any
  `server_ffmpeg` render has `claimed_by` set and `updated_at` within 15 minutes.
  RenderPanel auto-falls-back to browser FFmpeg.wasm when false.
- **Reason:** No new table or health endpoint needed — heartbeats already exist.
  Until the founder deploys the worker, every visitor transparently gets the
  browser path; the moment the worker goes live, the server engine lights up.
- **Reverse:** Replace the query with a dedicated health check or remove the
  fallback to force server-only.

### D14. Character-consistency claim restored after honest 6-scene proof (2026-09-25)
- **Decision:** The claim "characters stay consistent throughout" was removed pending
  proof; the 60s demo's 6 AI stills were judged honestly (same woman, early 30s,
  short black hair, rust-orange jacket in every scene — see `demo-assets/proof.txt`)
  and the claim is restored. If a future render fails the same test, the claim
  comes back off.
- **Reason:** Claims must track evidence, in both directions.
- **Reverse:** Remove the sentence from `StyleGallery.tsx` again.

### D13. Root `.env.example` extended (not a separate worker/.env.example)
- **Decision:** Worker env vars were appended to the existing root `.env.example`;
  `docker-compose.yml` reads root `.env`.
- **Reason:** The task spec named root `.env.example`; one env file avoids the
  founder maintaining two files with the same Supabase secrets in both.
- **Reverse:** Split into `worker/.env.example` and point compose `env_file` there.
