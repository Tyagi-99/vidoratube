# VidoraTube Render Worker

Server-side video renderer using **native FFmpeg** (not wasm). Polls the
`renders` table for queued `server_ffmpeg` jobs, renders them, uploads the MP4
to Supabase Storage, and marks the job complete. Progress is reported via the
`heartbeat_render_job` RPC, which the web UI subscribes to over Realtime.

## Run locally

Prerequisites: Node 20+, `ffmpeg` + `ffprobe` on PATH.

```bash
cd worker
npm install

# Required: point at your Supabase project (service role — never in browsers)
export SUPABASE_URL="https://xyz.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="sb_secret_..."

# Optional
export RENDER_BUCKET="generated-videos"   # default
export FFMPEG_PATH="ffmpeg"               # default
export WORK_DIR="/tmp/vidora-worker"      # default
export POLL_INTERVAL_SEC="5"              # default

npm run dev     # tsx watch mode
# or
npm run build && npm start
```

The worker needs these RPCs on the database: `claim_render_job` /
`heartbeat_render_job` (both in
`supabase/migrations/20260925120000_schema_reconciliation.sql`),
`worker_heartbeats` (`20260925197000_worker_heartbeats.sql`),
`requeue_stale_renders` (`20260925210000_requeue_stale_renders.sql`),
`finalize_render_billing` (`20260925220000_exact_render_settle.sql`), and
`requeue_stale_chapters` (`20260925230000_chapters.sql`). Apply them via the
dashboard SQL editor in filename order if they are not already live — the
full applied list lives in `docs/PHASE4_MIGRATION_LIST.md`.

## How jobs flow

1. Web app inserts into `renders` with `engine='server_ffmpeg'`,
   `status='queued'`, and the timeline in `meta` (validated by
   `RenderJobMetaSchema` in `src/types.ts`).
2. Worker claims via `claim_render_job()` — atomic, `SKIP LOCKED`, 5-minute
   lease. Crashed workers' jobs are reclaimed automatically.
3. Pipeline: download assets → per-scene segments (resume-safe) → concat →
   audio mix → ASS word captions → faststart finalize → upload.
4. `finishJob` marks `completed`/`failed`/`cancelled`. Retries: a failed job
   with `attempts < max_attempts` goes back to `queued`.
5. UI cancels gracefully via `cancel_requested=true`; the worker checks
   between stages.

## VPS deployment (systemd)

On an Ubuntu VPS with Node 20+ and FFmpeg:

```bash
# 1. Copy this directory to /opt/vidora-worker, then:
cd /opt/vidora-worker && npm install --omit=dev && npm run build

# 2. Service user + env
sudo useradd -r -m vidora-worker
sudo mkdir -p /var/lib/vidora-worker && sudo chown vidora-worker /var/lib/vidora-worker
sudo -u vidora-worker tee /var/lib/vidora-worker/.env >/dev/null <<'EOF'
SUPABASE_URL=https://xyz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
WORK_DIR=/var/lib/vidora-worker/work
EOF
chmod 600 /var/lib/vidora-worker/.env

# 3. Unit file /etc/systemd/system/vidora-worker.service
```

```ini
[Unit]
Description=VidoraTube render worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=vidora-worker
WorkingDirectory=/opt/vidora-worker
EnvironmentFile=/var/lib/vidora-worker/.env
ExecStart=/usr/bin/node /opt/vidora-worker/dist/index.js
Restart=always
RestartSec=10
# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/vidora-worker

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now vidora-worker
journalctl -u vidora-worker -f
```

Scale horizontally: run more units/hosts — claiming is atomic so jobs never
double-process. One worker ≈ one concurrent render; raise per-host
concurrency only with enough RAM/CPU.

## Benchmarking (20-minute Story Mode)

`scripts/benchmark-20min.ts` measures end-to-end render time for a 20-minute
Story Mode video on one worker, against the < 15 minute investor target. It
spends no money: all TTS/LLM/image inputs are synthetic (generated locally),
while every FFmpeg stage is real. The harness auto-detects the chapter
implementation: it drives the REAL `src/chapters.ts` `renderChapter` +
`stitchChapters` (single x264 pass per chapter: solid-color background +
subtitles burn-in, preset medium CRF 20; stitch = concat copy + faststart),
falling back to a `src/pipeline.ts`-mirroring baseline (per-scene still
encodes, AAC 160k audio mix with sidechain ducking, ASS burn-in) only if
`src/chapters.ts` is absent.

```bash
cd worker
npx tsx scripts/benchmark-20min.ts --smoke   # 1 chapter x 10 s, ~2 min, no results file
npx tsx scripts/benchmark-20min.ts            # full: 2 x 150 s chapters, writes benchmark-results.md + .json
```

Methodology (full version in the script header): render 2 chapters (300 s of
media) through the real pipeline, then project 8 chapters x 150 s = 1200 s
with the unit-tested model in `src/benchmark-model.ts`
(`total = ceil(8/C) x median(chapter wall) + stitch`, loudnorm extrapolated
linearly). Both measured and projected numbers are reported; TTS/LLM/image-gen
time is excluded by design (separate pre-stage) and stated in every report.
The `-concurrency` flag controls the projected chapter parallelism
(`1` = current sequential code, `2` = `WORKER_CHAPTER_CONCURRENCY` default,
`4` = hypothetical bigger VPS). Run on a quiet machine - the results file
records load average alongside the numbers.

Latest results: `worker/benchmark-results.md` (regenerate after pipeline
encode changes).

## Security notes

- The service-role key lives **only** in the worker environment. It bypasses
  RLS — the worker validates `job.user_id` ownership implicitly by only
  touching the claimed job row.
- All media moves over signed URLs; the worker never needs public buckets.
- `RenderJobMetaSchema` (zod) rejects malformed payloads before any FFmpeg
  invocation. Asset refs are storage paths or https URLs only.

## Docker deploy (Oracle Cloud) — recommended

The repo root ships everything the founder needs:

- `worker/Dockerfile` — Node 20 + native FFmpeg, non-root, no exposed ports.
- `docker-compose.yml` (repo root) — one `worker` service (container `vidora-render-worker`), `.env` as env_file.
- `.env.example` (repo root) — copy to `.env`, fill `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. For the full worker-only variable reference (every var, what it is, where to get it, secret or not) see `worker/.env.example`.
- `scripts/deploy-worker.sh` — one-command deploy.

### One-time host setup (Oracle Cloud, Ubuntu 22.04+)

```bash
# on the Oracle instance
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-plugin
sudo usermod -aG docker ubuntu   # then re-login
```

### Deploy / redeploy

```bash
# from your laptop, repo root, with .env filled in:
WORKER_HOST=ubuntu@<oracle-ip> ./scripts/deploy-worker.sh
```

The script builds the image, ships it as a tarball (no registry needed),
copies `docker-compose.yml` + `.env`, and restarts the container. Heartbeats
in the `renders` table (`stage`, `progress`, `updated_at`) are the health
signal; the app keeps its browser FFmpeg.wasm fallback until the worker is
verified live.

### Liveness heartbeat

The worker upserts `worker_heartbeats(worker_id, last_seen_at)` on boot and
every 60 seconds while idle (`reportWorkerHeartbeat`). The app's
`getServerWorkerStatus` treats a heartbeat within the last 15 minutes as
"worker online" — this is what lets a freshly deployed worker (no claimed
renders yet) show as available immediately. Heartbeat failures are logged but
never stop the render loop. The table is RLS-enabled with no client policies
(service_role only); apply with the other migrations.

### Queue guarantees

- Claim: `claim_render_job()` — `FOR UPDATE SKIP LOCKED`, one worker wins.
- Lease: 5-minute claim lease + `heartbeat_render_job()` progress pings; a
  dead worker's jobs become claimable again automatically.
- Retries: `attempts < max_attempts` (default 3 = initial try + 2 retries),
  then the job is marked failed and the reserved minutes are refunded.
