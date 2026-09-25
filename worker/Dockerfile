# VidoraTube render worker — native FFmpeg, Node 20.
#
# Build:   docker build -t vidora-render-worker ./worker
# Run:     docker compose up -d   (from the repo root; reads .env)

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim AS runtime
# Native FFmpeg + ffprobe (no wasm here).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && ffmpeg -version | head -1

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist ./dist

# Never run as root.
RUN useradd --create-home --shell /bin/false vidora \
  && mkdir -p /tmp/vidora-worker \
  && chown -R vidora:vidora /app /tmp/vidora-worker
USER vidora

ENV NODE_ENV=production \
    WORK_DIR=/tmp/vidora-worker \
    POLL_INTERVAL_SEC=5 \
    CONCURRENCY=1

# The worker exposes no ports; health is observed via the renders table
# heartbeats. This keeps the container honest about crashing.
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "process.exit(0)"

CMD ["node", "dist/index.js"]
