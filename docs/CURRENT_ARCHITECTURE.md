# VidoraTube — Current Architecture

Phase 0a audit, generated 2026-09-27. Read-only analysis of `~/workspace/vidoratube`
(branch `main`). Every claim is grounded in file/line evidence or command output
from the audit workers. No code was modified; no git operations were run.

## 1. Stack

| Layer | Choice | Version | Evidence |
|---|---|---|---|
| Framework | TanStack Start (SSR) | 1.168.32 (`@tanstack/react-start`) | `package.json` |
| Router | TanStack Router, file-based | 1.170.18 | `src/routeTree.gen.ts`, `src/routes/README.md` |
| SSR server | Nitro | 3.0.260603-beta | `src/server.ts` bootstraps `@tanstack/react-start/server-entry` |
| Build | Vite | 8.2.0 | `package.json`; `predev`/`prebuild` run `scripts/vendor-ffmpeg-core.mjs` |
| Language | TypeScript (strict) | 5.8.3 | `tsconfig`: `strict`, `noUnusedLocals`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` all on |
| UI | React | 19.2.0 | `package.json` |
| Styling | Tailwind CSS v4 + shadcn "new-york" | Tailwind 4.2.1 (`@tailwindcss/vite`) | `src/styles.css` (`@import "tailwindcss"`), `components.json` |
| State / data | TanStack Query only | 5.101.1 | `src/router.tsx` (`getRouter`), `src/routes/__root.tsx:267` (`QueryClientProvider`) |
| Backend calls | TanStack Start server functions | `createServerFn` + `useServerFn` in `src/lib/*.functions.ts` | e.g. `src/lib/publish.functions.ts` (813 lines) |
| Database / auth / storage | Supabase (Postgres + Auth + Storage) | `@supabase/supabase-js` 2.112.3 | `src/integrations/supabase/` |
| Render (browser) | FFmpeg.wasm | `@ffmpeg/ffmpeg` 0.12.15, `@ffmpeg/core` 0.12.10 | `src/lib/render/browser-render.ts`, `scripts/vendor-ffmpeg-core.mjs` |
| Render (server) | Native FFmpeg worker (separate Node package) | `@vidora/render-worker` | `worker/` (`dev`/`build`/`start`/`benchmark`) |
| Unit tests | Vitest | 3.2.4 (`src/**/*.test.ts`, node env) | `vitest run`: 850/850 pass |
| E2E tests | Playwright | 1.63.0 | `playwright.config.ts`, `e2e/*.spec.ts`, `test:e2e` script (not run in this audit) |
| Lint/format | ESLint 9 + Prettier | — | `package.json` |
| Observability | Sentry (`@sentry/tanstackstart-react`) + PostHog | — | `src/lib/analytics.ts` |
| Global store | None | — | no zustand/redux imports in `src/` |

## 2. Repository layout (top level)

```text
src/
  routes/            # file-based routes (TanStack Start) incl. src/routes/api/
  components/
    ui/              # ~45 shadcn "new-york" primitives
    vidora/          # 45 product components (+ vidora/agency/, vidora/cinema/)
  lib/
    *.functions.ts   # server functions (studio, publish, admin, jobs, billing…)
    *.server.ts      # server-only modules (providers, youtube, meta, render…)
    providers/       # provider contracts + registry + adapters
    render/          # browser FFmpeg.wasm render engine
    billing/         # per-minute pricing math, webhook signature verify
    jobs/            # stage-claim concurrency guards
  integrations/supabase/  # client + auth middleware
  styles.css         # Tailwind v4 theme (oklch, dark-first)
  router.tsx / server.ts / start.ts
supabase/migrations/  # 36 migration files (20260817… → 20260926050000)
worker/              # @vidora/render-worker (native FFmpeg, polls `renders`)
e2e/                 # Playwright specs (public, authenticated, mobile, stranger)
scripts/             # vendor-ffmpeg-core.mjs, etc.
docs/                # DECISIONS.md (D1–D87), plans, runbooks
```

Largest server modules: `publish.functions.ts` (813 lines), `admin.functions.ts`
(808), `research.functions.ts` (712), `safety.ts` (697), `youtube.server.ts` (667),
`jobs.functions.ts` (664), `meta-publish.server.ts` (584).

## 3. Routing inventory (TanStack Start file-based)

| Route path | File | Purpose |
|---|---|---|
| `/` | `src/routes/index.tsx` | Marketing homepage (hero, pipeline, voice wall, style gallery, demo reel, pricing, FAQ) |
| `/auth` | `src/routes/auth.tsx` | Sign-in/sign-up (Supabase email+password, lines 100/113) |
| `/reset-password` | `src/routes/reset-password.tsx` | Password reset |
| `/contact` | `src/routes/contact.tsx` | Contact form → `contact_messages` |
| `/features` | `src/routes/features.tsx` | Marketing features page (product-mock studio) |
| `/pricing` | `src/routes/pricing.tsx` | Pricing page |
| `/privacy`, `/terms` | `src/routes/privacy.tsx`, `terms.tsx` | Legal pages (content from `src/config/legal.ts`) |
| `/status` | `src/routes/status.tsx` | Public system-status dashboard (`getSystemStatus`, noindex) |
| `/guides/` | `src/routes/guides.index.tsx` | Guides index |
| `/guides/$slug` | `src/routes/guides.$slug.tsx` | Individual guide (plain-text sections) |
| `/r/$code` | `src/routes/r.$code.tsx` | Referral invite landing (validates code, redirects to signup) |
| `/robots.txt` | `src/routes/robots.txt.tsx` | SEO server route |
| `/sitemap/xml` | `src/routes/sitemap.xml.tsx` | XML sitemap server route — NOTE: served at `/sitemap/xml`, NOT the conventional `/sitemap.xml` (returns 404) |
| `/studio` | `src/routes/_authenticated/studio.tsx` | Main app dashboard (job creation, ModeChooser, YouTube panel, onboarding) |
| `/projects/` | `src/routes/_authenticated/projects.index.tsx` | Project list / CRUD |
| `/projects/$projectId` | `src/routes/_authenticated/projects.$projectId.tsx` | Project detail (studio editor) |
| `/research/` | `src/routes/_authenticated/research.index.tsx` | Research projects list |
| `/research/$projectId` | `src/routes/_authenticated/research.$projectId.tsx` | Research project detail |
| `/agency/` | `src/routes/_authenticated/agency.index.tsx` | Agency workspace list |
| `/agency/$workspaceId` | `src/routes/_authenticated/agency.$workspaceId.tsx` | Workspace detail (members, approvals) |
| `/analytics/` | `src/routes/_authenticated/analytics.index.tsx` | Channel analytics |
| `/billing/` | `src/routes/_authenticated/billing.index.tsx` | Plans/billing UI |
| `/admin`, `/admin/{content,integrations,jobs,messages,plans,safety,users}` | `src/routes/_authenticated/admin*.tsx` | Founder admin console |
| `/api/public/meta-callback` | `src/routes/api/public/meta-callback.ts` | Meta (Facebook Login) OAuth callback |
| `/api/public/youtube-callback` | `src/routes/api/public/youtube-callback.ts` | Google OAuth callback (YouTube channel connection) |
| `/api/webhooks/dodo` | `src/routes/api/webhooks/dodo.ts` | Dodo Payments webhook (signature-verified, idempotent) |
| `/api/webhooks/stripe` | `src/routes/api/webhooks/stripe.ts` | Stripe webhook |
| `/api/webhooks/razorpay` | `src/routes/api/webhooks/razorpay.ts` | Razorpay webhook |
| (pathless layout) | `src/routes/_authenticated/route.tsx` | Auth gate: signs out anonymous sessions, redirects non-app-users to `/auth` |
| (shell) | `src/routes/__root.tsx` | App shell: QueryClientProvider, theme, fonts, Sentry/PostHog, security headers |

Runtime check (dev server, 2026-09-27): all routes above returned HTTP 200;
unknown short code `/r/testcode` → 307 to `/`; unknown paths render the app's
styled 404 (no stack traces); no SSR exceptions observed.

## 4. Request / data flow

```text
Browser
  → TanStack Start (Nitro SSR, src/server.ts: security headers, error-page normalization)
  → React route component
  → useServerFn(...) → createServerFn in src/lib/*.functions.ts
      → middleware: requireAppUser (src/lib/server-auth.ts) — rejects anonymous/guest JWTs fail-closed
      → Supabase Postgres (RLS enforced) / Storage (signed URLs) / external provider APIs
  → React Query cache invalidation → UI update
```

Public API surface (no auth): the 2 OAuth callbacks + 3 payment webhooks under
`src/routes/api/` only. Everything else app-facing goes through the
`_authenticated` gate + `requireAppUser`.

## 5. State management

React Query is the only state layer. `QueryClient` is created in
`src/router.tsx` (`getRouter`) and provided in `__root.tsx:267`. All server
interaction flows through server functions; URL search state via the router;
local form state via react-hook-form. There is no global client store.

## 6. Authentication

- Supabase Auth, email+password (`src/routes/auth.tsx:100-113`).
- `src/integrations/supabase/auth-middleware.ts` attaches Supabase auth to
  server functions; `requireAppUser` (`src/lib/server-auth.ts`) additionally
  rejects anonymous sessions fail-closed.
- `_authenticated/route.tsx` signs out anonymous users and redirects
  non-app-users to `/auth`.
- YouTube OAuth: `src/lib/youtube.server.ts` (scopes `youtube.readonly`,
  `youtube.upload`, `youtube.force-ssl`); tokens encrypted at rest with
  AES-256-GCM (`youtube.server.ts:212-249`); column-level GRANTs revoke the
  token column from `authenticated` (migration `20260818052111`).
- Meta Facebook Login: `src/lib/meta-publish.server.ts`; Graph v26; test
  Page/IG-account verification fail-closed (D67–D69).

## 7. Supabase

- **Migrations:** 36 files, `20260817…` → `20260926050000_s78_analytics_admin.sql`.
  No `supabase/functions/` directory — **no Supabase Edge Functions**; all
  server logic runs in the TanStack Start server (Nitro).
- **Tables (public schema):** `api_usage, abuse_signals, approvals,
  asset_provenance, billing_events, brand_kits, captions, categories,
  channel_stats, characters, client_channels, client_errors,
  contact_messages, content_assets, content_duplicate_flags, content_items,
  creator_accounts, creators, credit_ledger, disposable_email_domains,
  integrations, language_quality_gates, language_voices, languages,
  learning_insights, meta_connections, music_tracks, niches, notifications,
  nps_responses, outlier_videos, platform_video_stats, plans, pricing_plans,
  profiles, projects, publish_jobs, publish_warnings, rate_limit_buckets,
  referrals, render_chapters, renders, research_projects, retention_curves,
  rights_decisions, safety_rules, safety_scores, scenes, seo_metadata,
  site_content, subscriptions, thumbnails, tts_cache, user_roles,
  video_analytics, video_ideas, video_jobs, voiceovers, worker_heartbeats,
  workflow_job_events, workflow_jobs, youtube_api_cache, youtube_connections`.
- **RLS:** enabled on all tables (69 `ENABLE ROW LEVEL SECURITY`
  statements); predominantly owner-scoped. Public-read catalog tables
  (`languages`, `language_voices`, `language_quality_gates`,
  `music_tracks`, `plans`, `categories`, `safety_rules`, `site_content`)
  are intentional, writes service-role-only. A RESTRICTIVE "No guest
  sessions" policy excludes anonymous JWTs across tables.
- **Storage buckets:** `generated-videos` (private), `brand-logos`
  (private); owner-scoped object policies; renders served via 7-day signed URLs.
- **DB functions:** `debit_credits_for_minutes`,
  `refund_credits_for_minutes` (idempotent, per-minute credits),
  `claim_render_job` (atomic, `SKIP LOCKED`, 5-min lease),
  `heartbeat_render_job`, `requeue_stale_renders`, `touch_updated_at`.
- Full schema detail: see `DATABASE_ARCHITECTURE.md`.

## 8. Video-render pipeline (existing strength)

Two engines selected by `src/lib/engine-select.ts` (`"browser"` | `"server"`);
server is chosen only when the worker heartbeat is alive, otherwise the app
falls back to browser rendering.

- **Browser engine (FFmpeg.wasm):** `src/lib/render/browser-render.ts`
  renders the timeline to a genuine H.264/AAC MP4 in-page; scene-by-scene
  with IndexedDB segment flushing (`idb.ts`), 24h resume TTL; worker thread
  `ffmpeg-worker.ts`; core vendored by `scripts/vendor-ffmpeg-core.mjs`
  (runs on `predev`/`prebuild`); hook `useComposeJobMp4.ts`.
- **Server engine (native FFmpeg worker):** separate Node package
  `worker/` (`@vidora/render-worker`, scripts `dev`/`build`/`start`/`benchmark`).
  Polls `renders` for `engine='server_ffmpeg'` queued jobs; claims via
  `claim_render_job()` RPC (atomic, `SKIP LOCKED`, requeue on crash);
  pipeline: download assets → per-scene segments → concat → audio mix → ASS
  captions → faststart → upload to `generated-videos` → `finishJob`
  (`completed`/`failed`/`cancelled`, retry while `attempts < max_attempts`).
  Progress via `heartbeat_render_job` RPC, UI subscribes over Realtime;
  `worker_heartbeats` table drives `worker-health.ts`.
- Render rows: `renders` (+ `render_chapters`, thumbnail provenance).

## 9. Job infrastructure

- **Render queue:** DB-backed (`renders` + `claim_render_job` /
  `heartbeat_render_job` / `requeue_stale_renders` RPCs) + external poll
  worker. No Redis/BullMQ.
- **Video-job pipeline:** `video_jobs` table with stage-claim concurrency
  guards (`src/lib/jobs/stage-claim.ts` — atomic `<stage>_claimed`
  transitions; stuck jobs reaped after 30 min); `workflow_jobs` /
  `workflow_job_events` for rights-aware workflow stages.
- **Retries:** worker-level (`attempts < max_attempts` → back to `queued`);
  idempotent billing webhooks via `billing_events` claim/mark.
- **No cron infra in-repo** (no pg_cron in config; `requeue_stale_renders`
  is invoked from server code/worker, not scheduled in the repo).

## 10. Credits system

- Ledger: `credit_ledger` (owner RLS). **Per-finished-minute model**
  (migration `20260925194000_per_minute_credits.sql`):
  `src/lib/credits.ts` `debitMinutesForJob` / `refundMinutesForJob` call the
  idempotent RPCs with the job id as ref (retries can't double-charge);
  refunds on failure. Debits run with the service-role client **before**
  expensive provider calls.
- Pricing math: `src/lib/billing/per-minute.ts`; plans: `src/lib/billing/plans.ts`;
  provider cost tracking: `src/lib/api-cost.ts` → `api_usage` table;
  purchase webhooks credit via `webhooks.server.ts` `processDomainEvent`.
- Billing UI "Coming soon" until `paymentsLive()` env check passes (D2).

## 11. Observability

Sentry + PostHog (`src/lib/analytics.ts`); `client_errors` table with
`error-capture.ts` client bootstrap; `/status` page runs `getSystemStatus`
real checks. Render progress via `workflow_job_events` / Realtime.

## 12. Infrastructure / deploy

- Hosted on Lovable (`https://vidoratube.lovable.app/`); repo pushes to
  `Tyagi-99/vidoratube` `main` trigger Lovable publish.
- Build emits a Cloudflare-worker preset (`.output/server/`,
  `.output/server/wrangler.json`, worker auto-named `tyagi-99-vidoratube`);
  `wrangler.toml.example` + `docker-compose.yml` exist at root.
- i18n: UI languages `en | hi` (`src/lib/i18n.ts:9`); DB `languages` table
  holds 12 languages (English `live`, 11 `beta`).
- Compliance/safety: `safety_rules`, `safety_scores`, `approvals` /
  `workspace_approvals` workflows, `asset_provenance`, music licensing
  (`music_tracks`), `thumbnails` provenance, `rights_decisions`.
