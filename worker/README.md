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

The worker needs the P2 migration applied (`claim_render_job` /
`heartbeat_render_job` RPCs): `supabase db push` or apply
`supabase/migrations/20260925143500_server_render_worker.sql`.

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

## Security notes

- The service-role key lives **only** in the worker environment. It bypasses
  RLS — the worker validates `job.user_id` ownership implicitly by only
  touching the claimed job row.
- All media moves over signed URLs; the worker never needs public buckets.
- `RenderJobMetaSchema` (zod) rejects malformed payloads before any FFmpeg
  invocation. Asset refs are storage paths or https URLs only.
