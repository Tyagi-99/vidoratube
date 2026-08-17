# Vidora AI — Dark mode, real backend, admin panel

Turn the current static Vidora AI marketing clone into a working product: theme toggle, accounts, credits, real saved video jobs with AI-written scripts, and an admin panel that controls site content, users, integrations, jobs and the contact inbox.

## 1. Dark / light mode

- Add a theme provider with `light | dark | system`, persisted in localStorage and applied via a `dark` class on `<html>`.
- Add a small inline script in the root shell so the stored theme applies before first paint (no flash, no hydration mismatch).
- Add a sun/moon toggle in the floating header (and in the mobile menu).
- Add a full dark palette to `src/styles.css` matching the teal/mint identity: deep teal-black surfaces, mint accents, adjusted borders and glow utilities.

## 2. Backend (Lovable Cloud)

Enable Lovable Cloud (database, auth, storage, server code).

**Auth:** email + password with instant confirm, plus Google sign-in. Routes: `/auth` (sign in / sign up), gated app area at `/app`, gated admin area at `/admin`.

**Tables**
- `profiles` — id, display name, avatar, credits, plan, status (active/suspended), created_at. Auto-created on signup via trigger.
- `user_roles` + `app_role` enum (`admin`, `user`) in a separate table with a `has_role()` security-definer function. First registered user can be promoted to admin by SQL seed.
- `video_jobs` — user_id, title, script, voice, format, status (queued/running/completed/failed), progress, step, credits_used, result_url, thumbnail, duration, created_at.
- `site_content` — key/value JSON blocks for hero, features, FAQ, results, CTA copy.
- `pricing_plans` — name, price, credits, features[], highlighted, sort order, active.
- `integrations` — provider key, label, enabled, config JSON (non-secret settings only), status, last_checked.
- `contact_messages` — name, email, subject, message, read/handled flag, created_at.
- `credit_ledger` — user_id, delta, reason, admin_id, created_at.

RLS on every table, with explicit GRANTs: users read/write only their own rows; `site_content` and `pricing_plans` are publicly readable but admin-only writable; `integrations`, `credit_ledger` and `contact_messages` are admin-only (contact insert allowed for anyone).

**Server functions**
- `submitContact` — validated public insert.
- `createVideoJob` — auth required; validates the script, checks and deducts credits, writes a job row, generates the narration script/scene breakdown with Lovable AI, then advances the job through the pipeline steps and completes with a placeholder render (real jobs, simulated final MP4).
- `getMyJobs`, `getJob` — user-scoped reads.
- Admin functions (role-checked server-side, never client-side): list/update users, grant/revoke credits, suspend, list/update jobs, CRUD site content + pricing plans, list/toggle integrations, read/resolve contact messages, dashboard stats.

Secrets for third-party API keys are stored in the encrypted secret store; the admin Integrations page manages the non-secret settings and enable/disable state, and prompts to add the key when one is missing. When you're ready to plug in a real video API, that provider gets added here and swaps out the simulated render step.

## 3. User app (`/app`)

- Dashboard: credits remaining, plan, recent jobs.
- New video: the existing generate dialog, now hitting the real backend — job persists, progress reflects the real row, result appears in the library.
- Library: all jobs with status, filters, and download/preview.
- Settings: profile, password, sign out.

## 4. Admin panel (`/admin`)

Sidebar layout, admin-role gated on both the route and every server function:
- **Overview** — users, jobs, credits used, revenue-ish stats, recent activity.
- **Users** — search, view, grant/revoke credits, change role, suspend.
- **Jobs** — all video jobs, status, retry/fail, delete.
- **Content** — edit hero, features, FAQ, results and CTA copy for the public site.
- **Pricing** — edit plans/tiers shown on `/pricing`.
- **Integrations** — list of providers (AI, video, email, payments), enable/disable, config, key-present indicator, test button.
- **Inbox** — contact form submissions, mark handled.

The public pages read their copy from `site_content` / `pricing_plans` with the current hardcoded values seeded as defaults, so editing in admin updates the live site.

## 5. Header changes

Header becomes session-aware: signed out shows Log in / Start free; signed in shows an account menu with Dashboard, Admin (admins only) and Sign out.

## Technical notes

- TanStack Start server functions with `requireSupabaseAuth`; admin functions re-check role via `has_role` before doing privileged work.
- Roles live in `user_roles`, never on `profiles`.
- All inputs validated with zod on both client and server.
- Seed migration inserts default site content, the three pricing plans and integration rows so admin screens aren't empty on first load.
- Generated MP4 placeholder assets are stored in a private bucket and served via signed URLs.
