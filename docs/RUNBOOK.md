# VidoraTube Runbook

Operations guide for the person running Vidora AI in production.
Companion to `docs/GO_LIVE.md` (the one-time launch checklist).

## 1. Deploy

- **App**: push to GitHub `main` → Lovable syncs and publishes automatically.
  Verify: homepage loads, `/status` returns 200 with all checks green.
- **Migrations**: `supabase db push` (or apply new files in
  `supabase/migrations/` via the Supabase dashboard SQL editor, in filename
  order). Never edit an applied migration — write a new one.
- **Rollback**: app rollback = revert the commit and push (Lovable redeploys).
  DB rollback = restore from the pre-deploy Supabase backup; there is no
  automatic down-migration.

## 2. Render worker (VPS)

The server render worker (`worker/`) runs outside Lovable on a VPS.

```bash
# env (systemd EnvironmentFile or /etc/vidora-worker.env)
SUPABASE_URL="https://xyz.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="sb_secret_..."
```

- Deploy: copy `worker/` to the VPS, `npm install`, install the systemd unit
  from `worker/README.md`, `systemctl enable --now vidora-worker`.
- Logs: `journalctl -u vidora-worker -f`.
- A stuck render (lease expired > 5 min, no heartbeat) is auto-reclaimed by
  `claim_render_job()`; no manual intervention needed. To drain the worker
  before maintenance: `systemctl stop vidora-worker` — the in-flight job's
  lease expires and another worker (or a restart) picks it up from the
  checkpoint.
- Billing: the worker calls `finalize_render_billing` on completion — reserve
  10 min at enqueue, settle actual minutes, refund the difference.

## 3. Analytics cron (P8)

- Secret: `ANALYTICS_CRON_SECRET` in Lovable Cloud secrets.
- Schedule daily via Supabase pg_cron or an external scheduler hitting the
  `snapshotAnalyticsCron` server function with `{ cron_secret }`.
- Snapshots are idempotent (`UNIQUE(youtube_video_id, snapshot_date)`).

## 4. Webhooks (P7)

- Endpoints: `https://<domain>/api/webhooks/stripe`,
  `https://<domain>/api/webhooks/razorpay`.
- Replay a webhook safely: re-sending an event returns `deduped: true` and
  never double-grants (idempotent via `billing_events` + `grant_credits_once`).
- If credits weren't granted: check `billing_events` for the provider event id
  and `processed_at`; re-deliver from the Stripe/Razorpay dashboard.

## 5. Secrets inventory

| Secret | Where | Used by |
|---|---|---|
| `YOUTUBE_TOKEN_ENCRYPTION_KEY` | Lovable Cloud | YouTube OAuth token encryption |
| `LOVABLE_API_KEY` | Lovable Cloud | AI gateway (script/image/ideas) |
| `ELEVENLABS_API_KEY` | Lovable Cloud | Voiceover |
| `PEXELS_API_KEY` / `PIXABAY_API_KEY` | Lovable Cloud | Stock visuals |
| `JAMENDO_CLIENT_ID` | Lovable Cloud | Background music |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Lovable Cloud | USD billing |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | Lovable Cloud | INR billing |
| `ANALYTICS_CRON_SECRET` | Lovable Cloud | Analytics snapshots |
| `SUPABASE_SERVICE_ROLE_KEY` | VPS only | Render worker |
| `SITE_URL` | Lovable Cloud | Referral links, webhook URLs |

Rotate a secret by updating it in Lovable Cloud and republishing. YouTube
tokens are encrypted at rest — rotating `YOUTUBE_TOKEN_ENCRYPTION_KEY`
invalidates existing connections (users must reconnect).

## 6. Incident response

1. Check `/status` — it probes database, storage, AI gateway, ElevenLabs.
2. App errors: Lovable deployment logs; client errors surface via Sentry
   (when `VITE_SENTRY_DSN` is set).
3. DB: Supabase dashboard → logs; RLS issues → re-run
   `src/lib/rls-policies.test.ts` classification against the migration that
   changed.
4. Billing: never hand-edit `credit_ledger`. Use the idempotent RPCs
   (`grant_credits_once`, `debit_credits_amount_once`) with a deterministic
   ref so retries are safe.
5. YouTube quota: Data API has a 10,000 units/day default cap — the 24h
   `youtube_api_cache` keeps usage near ~1 unit per 50 videos. If quota is
   exhausted, outlier import and analytics snapshots degrade gracefully
   (cached data served with a stale notice).

## 7. Backups

- Supabase: enable daily backups in the project settings before launch.
- `generated-videos` bucket: private; lifecycle policy to be set per cost
  review (no auto-delete configured — watch storage growth).
