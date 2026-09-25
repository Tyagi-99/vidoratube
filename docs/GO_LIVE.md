# GO_LIVE Checklist

The single ordered list of everything a human must do to take Vidora AI from
"code complete" to "serving paying users". Code work is done (P0–P10 on GitHub
`main`); every item below is an account, secret, or verification action.

Do them in order — later steps depend on earlier ones.

## Phase 1 — Database & platform

- [ ] **Apply all migrations to live Supabase.** P2–P9 migrations have never
  been confirmed on the live database: `supabase db push` (or apply
  `supabase/migrations/20260925*.sql` in order via the dashboard).
- [ ] **Enable Supabase Realtime** for the `renders` table (server-render
  progress UI depends on it).
- [ ] **Enable daily Supabase backups** in project settings.
- [ ] **Set `SITE_URL`** in Lovable Cloud secrets (production domain; used by
  referral links and webhook URLs).

## Phase 2 — Secrets (Lovable Cloud)

- [ ] `YOUTUBE_TOKEN_ENCRYPTION_KEY` — ✅ already set (32-byte base64).
- [ ] `LOVABLE_API_KEY` — AI gateway for scripts/images/ideas.
- [ ] `ELEVENLABS_API_KEY` — voiceover (already configured per P0 audit;
      re-verify).
- [ ] `PEXELS_API_KEY` / `PIXABAY_API_KEY` — stock visuals (already configured
      per P0 audit; re-verify).
- [ ] `JAMENDO_CLIENT_ID` — free at developer.jamendo.com; background music
      shows an honest empty state until set.
- [ ] `ANALYTICS_CRON_SECRET` — generate a random value; used by the daily
      analytics snapshot job.

## Phase 3 — Render worker VPS

- [ ] **Provision a VPS** (Ubuntu) for `worker/`.
- [ ] Set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (VPS only, never in the
      browser).
- [ ] Install the systemd unit from `worker/README.md`;
      `systemctl enable --now vidora-worker`.
- [ ] **Live test**: enqueue a server render → watch the worker claim it →
      confirm the MP4 lands in storage → confirm Realtime progress in the UI.

## Phase 4 — Google / YouTube

- [ ] **Submit OAuth verification** in Google Cloud Console — follow
      `docs/GOOGLE_VERIFICATION.md` (scope justifications, demo video outline).
- [ ] **Record the 5-minute demo video** showing the OAuth flow.
- [ ] `/privacy` and `/terms` are live (shipped in P10) — link them in the
      verification form.
- [ ] **Real OAuth test** with a Google account (stays in testing mode until
      Google approves).
- [ ] **Quota extension request** (10k → 100k units/day) when usage demands it.

## Phase 5 — Payments

- [ ] **Stripe**: create account → test keys → `STRIPE_SECRET_KEY` +
      `STRIPE_WEBHOOK_SECRET` → webhook endpoint
      `https://<domain>/api/webhooks/stripe` (4 events per `docs/BILLING.md`)
      → switch to live keys.
- [ ] **Razorpay**: create account → complete KYC → `RAZORPAY_KEY_ID` /
      `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` → webhook endpoint
      `https://<domain>/api/webhooks/razorpay` → switch to live mode.
- [ ] **Live test**: make a real ₹1 / $1 purchase → confirm credits granted →
      refund it → replay a webhook → confirm `deduped: true`, balance moves once.

## Phase 6 — Scheduled jobs

- [ ] **Analytics cron**: schedule `snapshotAnalyticsCron` daily (pg_cron or
      external scheduler) with `{ cron_secret: ANALYTICS_CRON_SECRET }`.
      See `docs/P8_CRON.md`.

## Phase 7 — Pre-launch verification

- [ ] **`npm audit --omit=dev`** on the operator's machine (blocked on the
      build VM by network policy) — fix high/critical, record in
      `docs/LAUNCH_SECURITY.md`.
- [ ] **Live RLS owner-isolation test**: run `supabase/tests/` assertions
      against staging — user A must not read user B's rows on any
      owner-scoped table.
- [ ] **Publish in Lovable**; verify `/status` returns 200 with all checks green.
- [ ] **E2E smoke on the live site**: homepage → pricing → signup → studio →
      research → publish flow loads without errors.

## Optional (post-launch)

- [ ] Sentry DSN (`VITE_SENTRY_DSN`, `SENTRY_DSN_SERVER`) for error tracking.
- [ ] PostHog key (`VITE_POSTHOG_KEY`) for product analytics.
- [ ] `vidora.ai` domain / trademark decisions.
