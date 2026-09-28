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
  `DODO_API_KEY` + `DODO_WEBHOOK_SECRET` to Lovable Cloud Secrets. Create one
  product per plan in the Dodo dashboard and set `DODO_PRODUCT_IDS` to the JSON
  map, e.g. `{"creator":"prod_abc","studio":"prod_def","pack_s":"prod_ghi","pack_m":"prod_jkl","pack_l":"prod_mno"}`
  (slugs must match `src/lib/billing/plans.ts`: `creator`, `studio`, `pack_s`, `pack_m`, `pack_l`;
  format documented in `.env.example`).
  **Also set `DODO_ENVIRONMENT=live`** in Lovable Cloud Secrets — without it, checkout
  calls Dodo's *test* API even with live keys, and every checkout will fail auth.
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

## 9. Apply the three new Supabase migrations (Sprints 3–4)

**Done 2026-09-25:** the Sprints 0–2 migrations were all applied via the Lovable
Cloud/Database SQL editor, in order, all succeeded, tables verified
(`worker_heartbeats`, `notifications`, `languages`), and the live `/status`
schema-cache error was resolved:
- `supabase/migrations/20260925193000_languages_table.sql`
- `supabase/migrations/20260925194000_per_minute_credits.sql`
  (minute-based debit/refund RPCs + append-only conversion entries)
- `supabase/migrations/20260925195000_pricing_inr.sql`
  (`pricing_plans.price_monthly_inr`)
- `supabase/migrations/20260925196000_fix_minute_refund.sql`
  (CRITICAL: closes a money bug where refunds could mint credits without a
  matching debit; normalizes conversion rows to the exact reason
  `migration_per_minute`)
- `supabase/migrations/20260925197000_worker_heartbeats.sql`
  (worker liveness table for server-render feature detection)
- `supabase/migrations/20260925200000_notifications.sql`
  (Sprint 1–2: `notifications` table + RLS — powers the studio notification
  bell for render completion; new table only, nothing else touched)
- `supabase/migrations/20260925210000_requeue_stale_renders.sql`
  (Sprint 1–2: dead-worker requeue as server-side RPC; new function + index)
- `supabase/migrations/20260925220000_exact_render_settle.sql`
  (Sprint 1–2: exact-quote rows settle at the quoted credits; function-body
  replacement only)

**Pending — apply in order:**
- `supabase/migrations/20260925230000_chapters.sql`
  (`render_chapters` + `tts_cache` tables, RLS, `requeue_stale_chapters` RPC)
- `supabase/migrations/20260925233000_language_voices_and_gates.sql`
  (`language_voices` + `language_quality_gates` tables, RLS, per-language
  `llm_instructions` seeds)
- `supabase/migrations/20260925234000_music_tracks_public_read.sql`
  (policy change only: explicit public read on the shared music catalog —
  resolves the pre-publish security scan finding)

- **Where:** Lovable dashboard → Cloud/Database SQL editor, one file at a time
  (the GitHub repo is private to browser sessions — paste file contents inline).
  All are non-destructive (new tables/functions, policy recreation).
- **Time:** 10 min. Verify: `select count(*) from render_chapters;`,
  `select count(*) from language_voices;`, and reload `/status`.
- **Unblocks:** Long-form chapter rendering, per-language voice picker, and a
  clean security scan in production.

## 10. Transactional email for render completion (Resend)
- **What:** Without this, "your video is ready" is delivered as an in-app
  notification only (the studio bell — works today, zero setup). To also send
  email when a render finishes:
  1. Create a Resend account at https://resend.com and verify a sending
     domain (or use their test domain for trials).
  2. Create an API key (Dashboard → API Keys) — it starts with `re_`.
  3. Add `RESEND_API_KEY=re_...` to Lovable Cloud Secrets (and to your local
     `.env` for dev). Optional: `EMAIL_FROM="Vidora <updates@yourdomain.com>"`
     — must be on the verified domain; defaults to `Vidora
     <updates@vidora.ai>` which will NOT deliver until vidora.ai is verified
     (see item 5).
  4. Finish any render (or run the test account through one) and confirm the
     email arrives; check the notification bell regardless.
- **Where:** Resend dashboard + Lovable Cloud Secrets. Code is already live:
  `src/lib/notifications.server.ts` (`sendRenderCompleteEmail`), feature flag
  is automatic (key present → emails send; key absent → in-app only).
- **Time:** 20–30 min (domain DNS verification is the long pole; the in-app
  fallback works with 0 min).
- **Unblocks:** The "close the tab" email promise. Until then the promise
  holds via the in-app notification bell only — do not advertise email
  notifications in copy.

## 11. Apply the Sprints 3–4 + 5–6 Supabase migrations

- **What:** Apply in filename order via Lovable dashboard → Cloud/Database SQL
  editor (the GitHub repo is private to browser sessions — paste file contents
  inline, one file at a time). All are non-destructive (new tables/functions,
  policy recreation, ADD COLUMN IF NOT EXISTS).
- **Files:**
  - `supabase/migrations/20260925230000_chapters.sql` (`render_chapters` +
    `tts_cache` tables, RLS, `requeue_stale_chapters` RPC)
  - `supabase/migrations/20260925233000_language_voices_and_gates.sql`
    (`language_voices` + `language_quality_gates` tables, RLS, per-language
    `llm_instructions` seeds)
  - `supabase/migrations/20260925234000_music_tracks_public_read.sql`
    (policy change only: explicit public read on the shared music catalog —
    resolves the pre-publish security scan finding)
  - `supabase/migrations/20260926001000_renders_parent_id.sql` (Sprint 5–6:
    `renders.parent_id` self-referential FK + partial index; powers dubbing
    and Shorts parent linkage)
- **Note:** Sprints 3–4 were published live 2026-09-26 ~00:15 IST with
  migrations reported applied, but this file still marked the first three
  "Pending" — verify via
  `select table_name from information_schema.tables where table_name in
  ('render_chapters','tts_cache','language_voices','language_quality_gates')`
  and `select column_name from information_schema.columns where
  table_name='renders' and column_name='parent_id';` and apply whatever is
  missing.
- **Time:** 10–15 min.
- **Unblocks:** Long-form chapter rendering, per-language voice picker, clean
  security scan, dubbing/Shorts parent linkage.

## 12. Pexels API key (Cinema Mode live stock) — ~10 min

- **What:** Create a free Pexels account, confirm email, request an API key at
  https://www.pexels.com/api/ (use case: "Video-creation app searching stock
  photos/videos to illustrate documentary scenes; we display the creator's
  name and link back to Pexels per the license."). Add as server-side secret
  `PEXELS_API_KEY` in Lovable Cloud Secrets (and `.env` for dev — never
  commit).
- **Time:** ~10 min.
- **Unblocks:** Real Pexels stock in the Cinema planner (planner tries Pexels
  first). Until then the planner uses clearly-marked mock assets and scenes
  fall back to AI-generated visuals — nothing breaks. Free tier is
  rate-limited (limits shown on the Pexels API page after signup).

## 13. Pixabay API key (Cinema Mode fallback stock) — ~10 min

- **What:** Create a free Pixabay account → account settings → API section
  (https://pixabay.com/api/docs/), copy the account API key. Add as
  server-side secret `PIXABAY_API_KEY` in Lovable Cloud Secrets.
- **Time:** ~10 min.
- **Unblocks:** Pixabay fallback when Pexels has no match. One key is enough
  to go live; two gives fallback coverage. Free tier has per-minute request
  limits (shown on the API docs page).

## 14. Verify TTS voice IDs for dubbing — 30–60 min per language batch

- **What:** Dubbing only ever uses **verified** voices
  (`language_voices.verified`). Verified today: English (George, Sarah,
  Rachel, Domi — ElevenLabs), Hindi (Aisha, Arjun — ElevenLabs; Kavya, Vikram
  — gateway). For each additional language: pick a multilingual-capable
  premade voice in the ElevenLabs dashboard, run a real TTS call with a 2–3
  sentence script IN THE TARGET LANGUAGE and listen (end-to-end check, not
  just "id exists"), then
  `update language_voices set provider_voice_id='<id>', verified=true,
  selectable=true where language_code='<code>' and slot=N;` and mirror
  `verified: true` in `src/lib/voices.ts`, then `npx vitest run
  src/lib/voices.test.ts`.
- **Also:** beta languages stay behind the quality gate (3 golden scripts +
  back-translation + native-speaker review) before the "Beta" label drops —
  that needs native speakers, not code (see `language_quality_gates`).
- **Time:** 30–60 min per batch of voices.
- **Unblocks:** Dubbing into that language without the "no verified voice"
  error.

## 15. YouTube Data API verification + audit + quota — start now (2–6+ week wait)

- **What:** Three separate gates: (1) Google OAuth verification — dedicated
  Cloud project, YouTube Data API v3 enabled, External consent screen in
  production, policy pages live (privacy/terms covering Google user data use,
  retention, revocation, deletion), brand consistency, unlisted 3–5 min demo
  screencast (OAuth grant → each scope in-app → disconnect/revoke → data
  deletion), submit verification form; (2) YouTube API compliance audit
  (separate submission, recurs annually); (3) quota extension request with
  usage math. Full ordered checklist in-app: `/guides/youtube-api-app-review`.
- **Time:** 0.5–1 day prep; **review wait 2–6+ weeks** (the long pole — start
  steps 1–5 immediately; do not promise users a launch date before this
  clears).
- **Unblocks:** Real YouTube publishing (server-enforced human approval gate
  already exists in code; publishing stays founder-gated to the designated
  TEST channel until then).

## 16. Meta (Facebook/Instagram) app review — start business verification first

- **What:** Create a Meta app (Facebook Login + Instagram products), live
  privacy policy + terms + working data-deletion callback endpoint, business
  verification (legal docs, domain, phone/email — several business days),
  request minimum permissions with justifications
  (`pages_manage_posts`, `pages_read_engagement`, `instagram_basic`,
  `instagram_content_publish`), reviewer-ready test users + seeded demo Page,
  one screencast per permission, submit. Annual Data Use Checkup to stay
  approved. Full ordered checklist in-app: `/guides/meta-app-review`.
  (IG publishing needs a Facebook Page linked to an IG Business/Creator
  account — personal IG accounts can't publish via API.)
- **Time:** ~1 day prep; business verification several business days;
  review days–2 weeks.
- **Unblocks:** Real Instagram/Facebook publishing (founder-gated to TEST
  channels; human-approval gate stays enforced).

## 17. Apply the five Sprints 7–8 Supabase migrations

- **What:** Apply in filename order via Lovable dashboard → Cloud/Database SQL
  editor (paste each file's contents inline, one file at a time — the repo is
  private to browser sessions). All are non-destructive (new tables, ADD
  COLUMN IF NOT EXISTS, new RLS policies). Verify after each:
  `select table_name from information_schema.tables where table_name in
  ('thumbnails','workspaces','workspace_members','client_channels','brand_kits',
  'workspace_approvals','safety_rules','approvals','publish_warnings',
  'meta_connections','platform_video_stats','retention_curves','nps_responses');`
- **Files:**
  - `supabase/migrations/20260926002000_thumbnail_variants_provenance.sql`
  - `supabase/migrations/20260926010000_agency_workspaces.sql`
  - `supabase/migrations/20260926020000_safety_rules_approvals.sql`
  - `supabase/migrations/20260926030000_meta_connections.sql`
  - `supabase/migrations/20260926040000_s78_analytics_admin.sql`
- **Time:** 15–20 min.
- **Unblocks:** Thumbnails provenance, agency tier, safety approvals, Meta
  connections, analytics/admin metrics. Publish the site after applying.

## 18. Set the Sprints 7–8 server secrets (YouTube test channel + Meta)

- **What:** In Lovable Cloud Secrets (never in the repo), set:
  - `YOUTUBE_TEST_CHANNEL_ID` — the exact channel ID of your throwaway TEST
    channel (#7). Uploads are hard-gated on this value: any other channel is
    rejected before token refresh, network call, or quota use.
  - `META_APP_ID`, `META_APP_SECRET` — from your Meta app (#16).
  - `META_TOKEN_ENCRYPTION_KEY` — generate a fresh 32-byte base64 key
    (same method as the YouTube key in Sprint 0); used for the AES-256-GCM
    token envelope. Value must never be recorded anywhere.
  - `META_TEST_PAGE_ID`, `META_TEST_IG_USER_ID` — your designated TEST Page
    and TEST Instagram Business/Creator account. Publishing is hard-gated on
    these exact IDs.
- **Time:** 15 min once the accounts/apps exist.
- **Unblocks:** End-to-end publish testing through the real YouTube and Meta
  APIs (still founder-gated to TEST channels; human-approval gate enforced).
