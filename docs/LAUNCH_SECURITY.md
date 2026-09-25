# Launch Security Review — 2026-09-25

Final pass over the whole P0–P9 surface. Method: static analysis + bundle scan +
config review. A live-database owner-isolation test and `npm audit` still need
to run outside this VM (noted below).

## 1. RLS re-audit (all 51 tables)

Static audit (`src/lib/rls-policies.test.ts`) now classifies **every** table —
a new table that isn't placed in one of the three lists fails CI.

- **33 owner-scoped tables**: each has RLS enabled, an `auth.uid()` owner policy,
  and no permissive `USING (true)` / `WITH CHECK (true)`. Covers all P3–P9 tables:
  `research_projects`, `outlier_videos`, `video_ideas`, `youtube_api_cache`,
  `characters`, `asset_provenance`, `thumbnails`, `seo_metadata`, `publish_jobs`,
  `safety_scores`, `subscriptions`, `video_analytics`, `channel_stats`,
  `learning_insights`, `referrals`, plus the P0–P2 core (`projects`, `scenes`,
  `renders`, `video_jobs`, `voiceovers`, `captions`, `content_assets`, …).
- **8 intentionally public**: `contact_messages` (anon INSERT only),
  `site_content` / `pricing_plans` / `plans` (active-only) / `categories` /
  `niches` / `disposable_email_domains` (public read), `music_tracks`
  (authenticated read catalog).
- **5 locked-down**: `billing_events`, `rate_limit_buckets` (service_role only),
  `abuse_signals` (service_role write, admin read), `integrations` (admin only),
  `user_roles` (own-row read, admin writes).

**Gap found and fixed in P10**: `projects`, `renders`, `scenes`, `thumbnails`,
`seo_metadata`, `publish_jobs`, `subscriptions`, `voiceovers`, `captions`,
`content_assets`, `rights_decisions`, `workflow_jobs`, `creators`, and others
had correct owner policies in the migrations but were missing from the audit's
table list — a future regression there would have been invisible. Now covered.

**Not verified**: live owner-isolation (user A reading user B's rows) needs a
real database — run `supabase/tests/` SQL assertions against staging before
launch.

## 2. Dependency audit

`npm audit` could **not** run on this VM: the egress proxy denies the npm
security-audit endpoint (`policy_denied`). **Must run before launch** on the
operator's machine or in CI: `npm audit --omit=dev`, fix high/critical, and
record the result here.

## 3. Client-bundle secrets scan

Scanned the production JS bundle (`.output/public/assets/*.js`) for secret
patterns: `sk_live`, `rzp_live`, `AIza`, `whsec_`, `WEBHOOK_SECRET`,
`CRON_SECRET`, `JAMENDO`, `LOVABLE_API_KEY`, `SERVICE_ROLE`, private keys —
**zero hits**. One false positive investigated: `analytics.*.js` contains the
string `cron_secret` as a zod **field name** in a server-function input schema,
not a value. No secret values are embedded. (Only the publishable Supabase anon
key ships to the browser, by design.)

## 4. CSP review (P3–P9 routes)

**Issue found and fixed in P10**: `/billing` dynamically injects
`https://checkout.razorpay.com/v1/checkout.js`, which the CSP
(`script-src 'self' 'unsafe-inline'`) would have blocked in production —
INR checkout would silently fail. Fixed: `checkout.razorpay.com` added to
`script-src`; `api.razorpay.com` added to `frame-src` and `connect-src`
(payment iframe + API calls). Stripe uses server redirect, no SDK needed.

Remaining CSP posture: `unsafe-inline` scripts/styles required by TanStack
Start hydration and Tailwind (documented in `security-headers.ts`); `img-src
https:` intentionally broad for provider images; `frame-ancestors 'none'`;
HSTS + nosniff + strict referrer policy on all responses.

## 5. Other checks

- **YouTube tokens**: AES-256-GCM, random IV, 32-byte base64 key validated at
  startup; never sent to the browser (P0/P1).
- **Webhooks**: Stripe + Razorpay signatures verified with timing-safe compare;
  idempotent via `billing_events` dedupe (P7). Replays cannot double-grant
  (tested).
- **Abuse**: signup credits gated on verified email + disposable-domain block;
  rate limits on paid endpoints fail open (documented, P1).
- **Copy honesty**: new `copy-scan.test.ts` fails CI on banned phrases
  (monetization guarantees, fabricated counts, income claims); safety score
  labeled "estimate, not a guarantee" everywhere.
- **404**: `NotFoundComponent` in `__root.tsx`; root `errorComponent` catches
  route errors (per-route boundaries not added — accepted for launch).

## Verdict

No blocking static findings remain. Launch is gated on the two
outside-this-VM items: `npm audit` and the live RLS owner-isolation test.
