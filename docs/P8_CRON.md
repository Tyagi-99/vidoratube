# P8 Analytics Snapshot Cron

## What it does

`snapshotAnalyticsCron` (in `src/lib/analytics.functions.ts`) snapshots
YouTube performance for every user with published videos that are on a
snapshot day (1 day or 7 days after publish). One snapshot per video per day
(enforced by `UNIQUE(youtube_video_id, snapshot_date)`).

Snapshots are idempotent: re-running the same day is a no-op for videos
already snapshotted.

## Setup

### 1. Set the secret

Generate a random secret and add it to Lovable Cloud secrets as
`ANALYTICS_CRON_SECRET`:

```bash
openssl rand -hex 32
```

The server function compares the request's `cron_secret` input against this
value with a plain equality check. Keep it private — anyone with it can
trigger snapshots (read-only YouTube API calls + DB writes, no destructive
actions).

### 2. Schedule daily (pick one)

**Option A — Supabase pg_cron** (if available on the project):

```sql
select cron.schedule(
  'vidora-analytics-snapshot',
  '0 3 * * *',  -- 03:00 UTC daily
  $$
  select net.http_post(
    url := 'https://<your-domain>/api/_fn/snapshotAnalyticsCron',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('data', jsonb_build_object('cron_secret', '<ANALYTICS_CRON_SECRET>'))
  );
  $$
);
```

> Note: the exact server-function HTTP path depends on the TanStack Start
> deployment. Verify it against a staging deploy before scheduling.

**Option B — External cron** (cron-job.org, GitHub Actions, etc.):

```bash
curl -X POST https://<your-domain>/api/_fn/snapshotAnalyticsCron \
  -H 'Content-Type: application/json' \
  -d '{"data": {"cron_secret": "<ANALYTICS_CRON_SECRET>"}}'
```

### 3. Manual sync

Users can also sync from the Analytics page ("Sync now", rate-limited to
4/hour). The learning loop runs from the same page.

## Quota

- 1 `reports.query` per ~50 videos + 1 channel report per user per day.
- Negligible against the 10,000 units/day YouTube Data API quota.

## Failure modes

- No YouTube connection → user skipped, counted in `skippedNoConnection`.
- Revoked token → user skipped (reconnect CTA already exists in the app).
- Analytics API error → thrown; the cron response includes per-user errors.
- A video with no rows yet (too fresh) is skipped and retried the next day.
