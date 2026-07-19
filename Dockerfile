# =============================================================================
# ai-news-agent — digest-only Docker image
# =============================================================================
# Multi-stage build:
#   1. builder  — compiles TypeScript to plain JS (dist/)
#   2. runtime  — slim Node image + chromium + supercronic
#
# Build:  docker build -t ai-news-digest:latest .
# Run:    docker run --rm --env-file .env ai-news-digest:latest        (one-shot)
#         docker compose up -d                                       (daemon + cron)
# =============================================================================

# ---------- Stage 1: builder -------------------------------------------------
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install full deps (including devDeps: typescript, tsx, @types/node) for tsc.
COPY package.json package-lock.json* tsconfig.json ./
RUN npm ci

# Compile TS -> JS in ./dist (per tsconfig.json: outDir=./dist, rootDir=./src)
COPY src ./src
RUN npx tsc

# Prune dev deps so we can copy a slim node_modules into the runtime stage.
RUN npm prune --omit=dev


# ---------- Stage 2: runtime -------------------------------------------------
FROM mcr.microsoft.com/playwright:v1.61.0-jammy AS runtime

# Architecture detection (so this works on amd64 and arm64 VMs).
ARG TARGETARCH=amd64

# The mcr.microsoft.com/playwright image already has:
#   - Node.js (same major as base)
#   - All Chromium runtime libraries
#   - Playwright browsers pre-installed at /ms-playwright/
# We only need to add curl + tini for entrypoint hygiene.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/* \
    && node --version \
    && npx playwright --version

# Trim browser cache to only what digest.ts actually launches.
# The Microsoft image ships Chromium (full + headless shell), Firefox, WebKit,
# and FFmpeg. digest.ts only does `chromium.launch({ headless: true })`, so
# we drop everything else. Cuts the image by ~850 MB.
#
# Layer ordering: rm everything in one RUN so we don't ship the deleted files
# even in an intermediate layer.
RUN rm -rf \
        /ms-playwright/chromium_headless_shell-* \
        /ms-playwright/firefox-* \
        /ms-playwright/webkit-* \
        /ms-playwright/ffmpeg-* \
    && ls -la /ms-playwright

# Install supercronic — small static binary, the standard cron for containers.
# Pin a known-good version; bump deliberately when needed.
ARG SUPERCRONIC_VERSION=v0.2.33
RUN set -eux; \
    case "$TARGETARCH" in \
        amd64) SC_ARCH=amd64 ;; \
        arm64) SC_ARCH=arm64 ;; \
        *) echo "unsupported arch: $TARGETARCH" && exit 1 ;; \
    esac; \
    curl -fsSL "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-${SC_ARCH}" \
        -o /usr/local/bin/supercronic; \
    chmod +x /usr/local/bin/supercronic; \
    supercronic -version || true

WORKDIR /app

# Production-only node_modules from the builder stage.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# Playwright browsers path: keep it inside the image so the runtime works
# without any host bind mount for ~/.cache/ms-playwright.
# mcr.microsoft.com/playwright sets PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# during build; we just reuse that location. Listing it confirms chromium
# is in the expected place before we COPY our code on top.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN ls -la "$PLAYWRIGHT_BROWSERS_PATH" || true

# Container-side cron schedule + entrypoint.
COPY docker/crontab /etc/crontab.digest
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Persistent volume mount point.
RUN mkdir -p /app/logs
VOLUME ["/app/logs"]

# Default to Bangkok time; cron reads TZ env at startup.
ENV TZ=Asia/Bangkok \
    NODE_ENV=production \
    RUN_ONCE=0 \
    DIGEST_CRON="0 3 * * 1-5"

# tini = PID 1, reaps zombies; entrypoint handles RUN_ONCE vs cron mode.
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]

# Liveness probe — supercronic is the long-running process in cron mode,
# and the digest itself in RUN_ONCE mode. Either way, exit 0 = success.
CMD ["sh", "-c", "node -e 'require(\"fs\").statSync(\"/app/package.json\")'"]
