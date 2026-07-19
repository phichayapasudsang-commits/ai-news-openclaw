#!/bin/sh
# =============================================================================
# docker/entrypoint.sh — ai-news-agent digest container entrypoint
#
# Modes:
#   RUN_ONCE=1   run a single digest pass and exit (default: cron mode)
#   DIGEST_CRON  cron expression; overrides the line in /etc/crontab.digest
#
# Examples:
#   docker run --rm --env-file .env -e RUN_ONCE=1 ai-news-digest
#   docker run -d --env-file .env -e DIGEST_CRON="0 3 * * 1-5" ai-news-digest
# =============================================================================

set -eu

# Render cron line with the env-provided schedule (or default).
DIGEST_CRON="${DIGEST_CRON:-0 3 * * 1-5}"
mkdir -p /app/logs
sed "s|__DIGEST_CRON__|${DIGEST_CRON}|" /etc/crontab.digest > /tmp/crontab.rendered

echo "[entrypoint] starting ai-news-digest container"
echo "[entrypoint] TZ=$TZ  RUN_ONCE=${RUN_ONCE:-0}  DIGEST_CRON='${DIGEST_CRON}'"
echo "[entrypoint] node $(node --version)"
echo "[entrypoint] digest crontab:"
sed 's/^/    /' /tmp/crontab.rendered

if [ "${RUN_ONCE:-0}" = "1" ]; then
    echo "[entrypoint] RUN_ONCE=1 — executing one digest pass now"
    cd /app
    exec node dist/digest.js
fi

echo "[entrypoint] starting supercronic"
exec supercronic -prometheus-listen-address ":9746" /tmp/crontab.rendered
