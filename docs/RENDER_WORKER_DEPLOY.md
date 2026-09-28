# Render worker — production deploy guide

How to deploy the native-FFmpeg render worker (`worker/`) to a VPS and verify
it is alive on the live site. Owner-only: every step below needs the founder
(SSH target, Supabase secrets, dashboard access).

## What the deploy package is

| Piece | Path | Purpose |
|---|---|---|
| Image definition | `worker/Dockerfile` | Node 20 + native FFmpeg, non-root, no exposed ports |
| Compose service | `docker-compose.yml` (service `worker`) | Builds `./worker`, wires `.env`, `restart: unless-stopped`, 3.5 CPU / 6 GB limits, 8 GB tmpfs work dir |
| One-command deploy | `scripts/deploy-worker.sh` | Builds image, ships tarball over SSH (no registry), restarts container, verifies it is running |
| Env reference | `worker/.env.example` | Every worker variable: what it is, where to get it, secret or not |

The worker polls Supabase for queued `server_ffmpeg` renders — it needs NO
inbound traffic and NO companion services (no local DB, no Redis). The only
health signal is the heartbeat table (see "Verify" below).

## Step 0 — one-time host setup (Oracle Cloud, Ubuntu 22.04+)

On the Oracle instance, once:

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-plugin
sudo usermod -aG docker ubuntu   # then re-login so the group takes effect
```

## Step 1 — fill in secrets (on your laptop, repo root)

```bash
cp .env.example .env   # .env is gitignored — never commit real values
```

Fill at minimum the two required values. Full reference: `worker/.env.example`.

### Secrets checklist

| Variable | Required? | Secret? | Where to get it | If missing/wrong |
|---|---|---|---|---|
| `SUPABASE_URL` | Yes | No (public) | Lovable dashboard → your project → Settings → API → Project URL | Container crashes on boot with `[worker] Invalid configuration: SUPABASE_URL…` |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | **YES** — bypasses all RLS | Same page → `service_role` key ("secret" key) | Crashes on boot (`min(20)` fails), or if it's the anon/publishable key instead: every RPC/storage call fails at runtime |
| `RENDER_BUCKET` | No (default `generated-videos`) | No | Lovable dashboard → Storage | Bucket must EXIST and be PRIVATE, or uploads fail after renders complete |
| `BRAND_LOGOS_BUCKET` | No (default `brand-logos`) | No | Same | Same — required only when brand-kit logos are used |
| `FFMPEG_PATH` / `FFPROBE_PATH` | No (defaults correct in the image) | No | — | Leave alone in Docker; only set for the systemd path with a custom binary |
| `WORKER_ID` | No (default `oracle-worker`) | No | You choose it | Set a distinct value per host when running multiple workers (appears in heartbeats, logs, claim leases) |
| `POLL_INTERVAL_SEC` | No (default `5`, range 1–300) | No | — | Lower = faster job pickup but more idle DB queries |
| `CONCURRENCY` | No (default `1`, range 1–4) | No | — | Raise only with RAM/CPU headroom; the compose limits (3.5 CPU / 6 GB) match the defaults |
| `WORKER_CHAPTER_CONCURRENCY` | No (default `2`, range 1–8) | No | — | CPU-bound; 2–3 is the sane default |

`scripts/deploy-worker.sh` fails fast if `SUPABASE_URL` or
`SUPABASE_SERVICE_ROLE_KEY` is empty in `.env`.

### DB pre-check (dashboard, before first deploy)

The worker needs these to exist in the live database (all applied on
2026-09-28 per `docs/PHASE4_MIGRATION_LIST.md`; re-verify if anything changed):

- `public.worker_heartbeats` — `20260925197000_worker_heartbeats.sql`
- RPCs `claim_render_job`, `heartbeat_render_job` — `20260925120000_schema_reconciliation.sql`
- RPC `requeue_stale_renders` — `20260925210000_requeue_stale_renders.sql`
- RPC `finalize_render_billing` — `20260925220000_exact_render_settle.sql`
- RPC `requeue_stale_chapters` — `20260925230000_chapters.sql`
- Storage buckets `generated-videos` and `brand-logos`, both PRIVATE

## Step 2 — deploy (one command, from your laptop, repo root)

```bash
WORKER_HOST=ubuntu@<oracle-ip> ./scripts/deploy-worker.sh
```

This builds the image, saves it as a tarball (no registry needed), copies
`docker-compose.yml` + `.env` to `/opt/vidora` on the host (override with
`REMOTE_DIR=...`), loads the image, runs `docker compose up -d`, and fails
if the container is not running. Set `SKIP_BUILD=1` to reuse the last local
tarball on redeploy.

Expected output ends with: `OK: vidora-render-worker is running on
ubuntu@<oracle-ip>.`

## Step 3 — verify the heartbeat on the live `/status` page

Open **https://vidoratube.lovable.app/status** (refetches every 60 s; you can
also force a re-check from the page).

| What you see | Meaning |
|---|---|
| "Render worker" row: **Down** · detail `no heartbeat recorded yet · 0 queued, 0 running` | Worker never deployed, or deployed but can't reach the DB. This is the current pre-deploy state. |
| "Render worker" row: **Operational** · detail `last beat just now · worker oracle-worker · 0 queued, 0 running` | ✅ Worker is alive. The worker upserts `worker_heartbeats` on boot and every 60 s while idle — a fresh deploy shows up immediately, before any render is claimed. |
| **Degraded** (heartbeat 15–60 min old) / **Down** (60+ min or none) | Thresholds from `src/lib/worker-health.ts` (15 min ok / 60 min degraded). Investigate the host/container before it hits Down. |

Troubleshooting if the heartbeat never appears:

1. `ssh $WORKER_HOST 'docker logs vidora-render-worker --tail 50'` — boot
   config errors (`[worker] Invalid configuration: …`) point at `.env`.
2. `ssh $WORKER_HOST 'docker compose ps'` in `/opt/vidora` — container must
   be `running` (restart policy brings it back after a host reboot).
3. DB check in the dashboard SQL editor:
   `select worker_id, last_seen_at from public.worker_heartbeats order by last_seen_at desc;`
   — empty + container running = the service-role key is wrong or the table/RPCs are missing.
4. Queue sanity: `select status, count(*) from public.renders where engine='server_ffmpeg' group by status;` — renders stuck `queued` while the worker is Operational means claims are failing; check container logs.

## Rollback

There is nothing to "undo" in the app: the web app keeps its browser
FFmpeg.wasm fallback, and server-engine renders simply sit `queued` with no
worker. To take the worker down:

```bash
ssh $WORKER_HOST 'cd /opt/vidora && docker compose down'
```

Running jobs claimed by the stopped worker are reclaimed automatically by
the 5-minute claim lease (`requeue_stale_renders`, invoked by the next
worker that boots — pg_cron is not installed, see KNOWN_ISSUES.md #3). No
data is lost; at worst a job renders twice within its `max_attempts` budget.
To redeploy an older build: check out the older commit locally, run the
deploy command again (it rebuilds from your checkout), and confirm the
`/status` heartbeat returns.

## Known limits (honest)

- **Not deployed yet.** As of 2026-09-28 no worker has ever run in
  production; server-engine renders have never been proven end-to-end
  against the live database. The render pipeline is exercised by
  `npm run test:worker` (87/87) and the real-FFmpeg benchmark
  (`worker/benchmark-results.md`, synthetic assets only).
- The service-role key is powerful: keep it in `.env` (gitignored) and the
  host only. If it leaks, rotate it in the dashboard and redeploy.
- `CONCURRENCY > 1` is untested at scale; the 3.5 CPU / 6 GB limits assume
  the defaults.
