# VidoraTube — Database Architecture

Phase 0a audit, 2026-09-27. Postgres via Supabase. Evidence: `supabase/migrations/*.sql`
(36 files, `20260817…` → `20260926050000_s78_analytics_admin.sql`).

## 1. Engine & access model

- Single Postgres database, accessed via `@supabase/supabase-js` 2.112.3.
- **No Supabase Edge Functions** — no `supabase/functions/` directory. All
  server logic runs in the TanStack Start server (Nitro); the DB is
  data + RLS + RPCs only.
- Migrations are applied manually via the Lovable dashboard SQL editor in
  filename order (Lovable does not auto-apply pushed migrations on publish).
  Known state: two migrations were applied in abbreviated production form —
  `20260926020000_safety_rules_approvals.sql` and
  `20260925233000_language_voices_and_gates.sql` — reconcile before relying
  on their full definitions.

## 2. Schema inventory (public schema, grouped by domain)

**Identity / access:** `profiles`, `user_roles`, `creator_accounts`,
`creators`, `workspaces`, `workspace_members`, `workspace_approvals`,
`approvals`, `referrals`.

**Billing:** `credit_ledger`, `plans`, `pricing_plans`, `subscriptions`,
`billing_events`, `disposable_email_domains`.

**Projects / production:** `projects`, `video_jobs`, `workflow_jobs`,
`workflow_job_events`, `renders`, `render_chapters`, `scenes`,
`script_versions` (via `scripts`? — see note), `voiceovers`, `captions`,
`thumbnails`, `characters`, `brand_kits`, `content_items`, `content_assets`,
`asset_provenance`, `music_tracks`, `seo_metadata`.

**Research / intelligence:** `research_projects`, `niches`, `outlier_videos`,
`video_ideas`, `channel_stats`, `client_channels`, `platform_video_stats`,
`video_analytics`, `retention_curves`, `learning_insights`.

**Publishing:** `publish_jobs`, `publish_warnings`, `youtube_connections`,
`meta_connections`, `integrations`.

**Safety / compliance:** `safety_rules`, `safety_scores`, `rights_decisions`,
`content_duplicate_flags`, `abuse_signals`.

**Ops / telemetry:** `api_usage`, `client_errors`, `notifications`,
`nps_responses`, `contact_messages`, `rate_limit_buckets`,
`worker_heartbeats`, `youtube_api_cache`, `tts_cache`,
`language_voices`, `language_quality_gates`, `languages`, `categories`,
`site_content`.

## 3. Migrations

- 36 files; naming mixes date-prefix (`20260817…`) and feature-prefix
  (`s78_…`) styles.
- Key migrations: `20260925194000_per_minute_credits.sql` (per-minute credit
  RPCs), `20260925193000_languages_table.sql` (12 languages),
  `20260925234000` (replaced the effectively-public `music_tracks` RLS
  tautology with an explicit documented public-read policy — D36),
  `20260925112402` + `20260925112703` (RESTRICTIVE "No guest sessions"
  policies), `20260818052111` (admin `has_role` SECURITY DEFINER; token
  column GRANT revocation), `20260926050000_s78_analytics_admin.sql` (latest).

## 4. Row-Level Security

- `ENABLE ROW LEVEL SECURITY` on **all** tables (69 statements across migrations).
- Predominantly owner-scoped (`*_own`, `auth.uid()`).
- **Intentional public-read** catalog/reference tables (writes
  service-role-only, accepted by design — D45): `languages`,
  `language_voices`, `language_quality_gates`, `music_tracks`, `plans`,
  `categories`, `safety_rules`, `site_content`.
- RESTRICTIVE "No guest sessions" policies exclude anonymous JWTs
  (`auth.jwt()->>'is_anonymous'` check) across tables.
- `youtube_connections` token column revoked from `authenticated` via
  column-level GRANTs.
- A static CI audit (`src/lib/rls-policies.test.ts`) asserts RLS enabled +
  owner policies per table across all migrations — runs in the 850-test suite.

## 5. Storage

| Bucket | Visibility | Evidence |
|---|---|---|
| `generated-videos` | private (`public=false`) | `INSERT INTO storage.buckets … ('generated-videos','generated-videos',false)` |
| `brand-logos` | private | migration |

Owner-scoped object policies ("Users read/upload own generated videos").
Final renders served via 7-day signed URLs (`renders.functions.ts`).

## 6. Database functions (RPCs)

| Function | Purpose |
|---|---|
| `debit_credits_for_minutes` / `refund_credits_for_minutes` | Idempotent per-minute credit debit/refund, job id as idempotency ref |
| `claim_render_job` | Atomic render-job claim (`SKIP LOCKED`, 5-min lease) |
| `heartbeat_render_job` | Worker progress heartbeat |
| `requeue_stale_renders` | Requeue crashed/expired render claims (invoked from server code/worker — **not** on a DB cron; no pg_cron in repo) |
| `touch_updated_at` | `updated_at` trigger helper |

All RPC invocations use parameterized args; no user-input SQL string
interpolation found in `src/` or `worker/src/`.

## 7. Gaps & risks for the $500M roadmap

1. **No pgvector** — the brief's vector-intelligence plans (similar
   channels/videos, thumbnail-reference discovery, research retrieval) need
   the extension + embedding pipelines; nothing exists yet.
2. **No DB-level scheduling** — `requeue_stale_renders` has no cron owner;
   today it depends on server/worker invocation. Any new periodic sync
   (YouTube analytics, trend ingestion) needs an explicit scheduler.
3. **Migration drift risk** — Lovable doesn't auto-apply migrations; the two
   abbreviated production applications noted above must be reconciled, and a
   strict apply-and-verify checklist is needed per release.
4. **No read-replica / partitioning story** — fine today; the intelligence
   dataset (channel/video snapshots at scale) will need time-partitioned
   snapshot tables and index planning before it grows.
5. Indexes are per-migration and adequate for current scale; re-derive from
   query patterns once the intelligence ingestion begins.
