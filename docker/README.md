# Docker (digest-only)

Self-contained image that runs `src/digest.ts` on a cron schedule.
Designed to deploy on any cheap/free VM (Oracle Cloud Always Free, Hetzner,
fly.io, etc.) without touching Node / Playwright on the host.

## Architecture

- **Multi-stage Dockerfile**: `node:20-bookworm-slim` builder compiles TS
  and trims devDependencies, then ships only `dist/` + production
  `node_modules` to a slim runtime.
- **Runtime**: based on `mcr.microsoft.com/playwright:v1.61.0-jammy`
  (Ubuntu Jammy + Node 22 + Chromium browser binaries pre-installed at
  `/ms-playwright`). Versioned to match `playwright-core ^1.61.x` so the
  bundled browsers are exactly the revision the app expects.
- **Cron**: [`supercronic`](https://github.com/aptible/supercronic) is a
  single static binary that reads a crontab file and runs jobs in foreground
  with proper signal handling (no daemon mode needed).
- **PID 1**: `tini` reaps zombies and forwards signals to supercronic so
  `docker stop` cleanly terminates the in-flight digest.
- **Logging**: digest writes to `/app/logs/digest.log`; mounted to the host
  so logs survive container restarts.

## Default schedule

`0 3 * * 1-5` — every weekday at 03:00 UTC = **10:00 Asia/Bangkok**.
Override per environment via `DIGEST_CRON` (see compose file).

## One-time setup

```bash
cd ai-news-agent

# 1. Put secrets in .env (compose mounts this file via env_file).
cp .env.example .env
# ... edit .env ...

# 2. Build image (first build pulls ~300 MB of node_modules + Chromium).
docker compose build

# 3. Smoke-test by running a single digest pass and exiting.
docker compose --profile oneshot up digest-once

# 4. Start the long-running cron daemon.
docker compose --profile cron up -d

# 5. Tail logs.
docker compose logs -f
# or: tail -f logs/digest.log

# 6. Stop the daemon.
docker compose --profile cron down
```

## Build args

The Dockerfile accepts one optional build arg:

| Arg                | Default | Notes                                             |
|--------------------|---------|---------------------------------------------------|
| `TARGETARCH`       | `amd64` | Set automatically by `docker buildx`. Use `arm64` for Oracle / Graviton. |

## Environment variables

| Var           | Default            | Notes                                            |
|---------------|--------------------|--------------------------------------------------|
| `DIGEST_CRON` | `0 3 * * 1-5`      | Cron expression interpreted by supercronic.      |
| `TZ`          | `Asia/Bangkok`     | Used by supercronic when interpreting the cron.  |
| `RUN_ONCE`    | `0`                | `1` = run one digest pass and exit (debug).      |
| `OPENAI_API_KEY`   | (required)   | Passed in via `.env`.                            |
| `OPENAI_API_BASE`  | (optional)   | For non-OpenAI endpoints (OpenClaw, etc.).       |
| `OPENAI_MODEL_NAME`| `ptm-minimax-m3` | Default model if unset.                          |
| `SUPABASE_URL`     | (required)   |                                                  |
| `SUPABASE_SERVICE_ROLE_KEY` | (required) |                              |

## Deploying to a free VM

**Oracle Cloud Always Free** (recommended for $0):
```bash
# On the VM (after provisioning an Ampere A1, Ubuntu 22.04+):
sudo apt update && sudo apt install -y docker.io docker-compose-plugin
# Copy project files in, then:
cd ai-news-agent
docker compose build
docker compose --profile cron up -d
```

The image is `linux/arm64` on Ampere; buildx picks `TARGETARCH` automatically.

## Troubleshooting

- **`page.goto: Timeout 30000ms exceeded` on papers-w-code** — Cloudflare
  blocking from the container's IP. Same as local; not specific to Docker.
- **`supercronic: invalid crontab`** — check `docker compose logs`; usually
  a typo in `DIGEST_CRON`.
- **Logs empty** — make sure `./logs/` exists on the host and is writable.
- **Want to test without waiting for cron** — `RUN_ONCE=1 docker compose
  --profile oneshot up digest-once`.

## Why base on `mcr.microsoft.com/playwright`?

We tried building a slim `node:20-bookworm-slim` image and installing
Playwright Chromium ourselves, but the Chromium extract step fails
reliably on Docker Desktop for Windows because of overlay-fs + NTFS host
file-timestamp weirdness (a known upstream issue). Microsoft's official
Playwright image is Ubuntu-based, has all system libs and browser
binaries pre-installed at the correct paths, and matches the Playwright
version we use. Trade-off: image is ~3.4 GB instead of ~600 MB. Acceptable
for a low-traffic cron job; if size matters, run `docker system prune` on
the host regularly.

**Note**: The Microsoft base image tag must match `playwright-core` major
version. We're on `playwright-core ^1.61.1` → base image `v1.61.0-jammy`.
If you bump playwright-core in `package.json`, bump the base image tag
in `Dockerfile` accordingly (or the runtime will fail looking for the
matching browser revision).
