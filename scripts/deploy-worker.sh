#!/usr/bin/env bash
#
# Deploy the VidoraTube render worker to Oracle Cloud (one command).
#
#   WORKER_HOST=ubuntu@203.0.113.10 ./scripts/deploy-worker.sh
#
# Optional:
#   REMOTE_DIR=/opt/vidora          # where the app lives on the host
#   SKIP_BUILD=1                    # reuse the last local image tarball
#
# The script never takes secrets as arguments: they come from .env at the
# repo root (gitignored), which is copied to the host.
#
# One-time host setup (see worker/README.md "Oracle Cloud setup"):
#   - Ubuntu 22.04+ with Docker Engine + compose plugin
#   - SSH key access as $WORKER_HOST's user (that user in the docker group)

set -euo pipefail
cd "$(dirname "$0")/.."

: "${WORKER_HOST:?Set WORKER_HOST, e.g. WORKER_HOST=ubuntu@203.0.113.10 $0}"
REMOTE_DIR="${REMOTE_DIR:-/opt/vidora}"
TARBALL="/tmp/vidora-render-worker.tar.gz"

if [[ ! -f .env ]]; then
  echo "ERROR: .env not found at repo root. Copy .env.example to .env and fill in SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY." >&2
  exit 1
fi

# Fail fast if the two required secrets are empty.
for var in SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY; do
  val="$(grep -E "^${var}=" .env | cut -d= -f2- | tr -d '\r' | xargs || true)"
  if [[ -z "$val" ]]; then
    echo "ERROR: $var is empty in .env" >&2
    exit 1
  fi
done

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  echo "→ Building worker image…"
  docker build -t vidora-render-worker:latest ./worker
  echo "→ Saving image tarball…"
  docker save vidora-render-worker:latest | gzip > "$TARBALL"
else
  [[ -f "$TARBALL" ]] || { echo "ERROR: $TARBALL missing (SKIP_BUILD=1 but no tarball). Run without SKIP_BUILD once." >&2; exit 1; }
fi

echo "→ Preparing $WORKER_HOST:$REMOTE_DIR…"
# shellcheck disable=SC2029
ssh "$WORKER_HOST" "mkdir -p '$REMOTE_DIR'"

echo "→ Copying compose file, env, and image…"
scp .env docker-compose.yml "$WORKER_HOST:$REMOTE_DIR/"
scp "$TARBALL" "$WORKER_HOST:$REMOTE_DIR/render-worker.tar.gz"

echo "→ Loading image and (re)starting the worker on the host…"
# shellcheck disable=SC2029
ssh "$WORKER_HOST" bash -s <<EOF
set -euo pipefail
cd '$REMOTE_DIR'
docker load -i render-worker.tar.gz
docker compose up -d
sleep 5
docker compose ps
EOF

echo "→ Verifying worker is running…"
# shellcheck disable=SC2029
if ssh "$WORKER_HOST" "docker inspect -f '{{.State.Running}}' vidora-render-worker" | grep -q true; then
  echo "OK: vidora-render-worker is running on $WORKER_HOST."
  echo "Watch heartbeats: select id, stage, progress, updated_at from renders where status='running' order by updated_at desc limit 5;"
else
  echo "ERROR: container is not running. Check logs:" >&2
  echo "  ssh $WORKER_HOST 'docker logs vidora-render-worker --tail 50'" >&2
  exit 1
fi
