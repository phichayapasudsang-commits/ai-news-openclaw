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

# Determine run script: "digest" (default) or "pipeline"
RUN_SCRIPT="${RUN_SCRIPT:-digest}"
if [ "$RUN_SCRIPT" = "pipeline" ]; then
    SCRIPT_NAME="index"
    LOG_NAME="pipeline"
else
    SCRIPT_NAME="digest"
    LOG_NAME="digest"
fi

# Render cron line with the env-provided schedule (or default).
DIGEST_CRON="${DIGEST_CRON:-0 3 * * 1-5}"
mkdir -p /app/logs

# Replace schedule and script names in crontab template
sed -e "s|__CRON_SCHEDULE__|${DIGEST_CRON}|" \
    -e "s|__SCRIPT_NAME__|${SCRIPT_NAME}|" \
    -e "s|__LOG_NAME__|${LOG_NAME}|" \
    /etc/crontab.digest > /tmp/crontab.rendered

echo "[entrypoint] starting ai-news-${RUN_SCRIPT} container"
echo "[entrypoint] TZ=${TZ:-Asia/Bangkok}  RUN_ONCE=${RUN_ONCE:-0}  DIGEST_CRON='${DIGEST_CRON}'"
echo "[entrypoint] node $(node --version)"
echo "[entrypoint] crontab configuration:"
sed 's/^/    /' /tmp/crontab.rendered

if [ "${RUN_ONCE:-0}" = "1" ]; then
    echo "[entrypoint] RUN_ONCE=1 — executing one ${RUN_SCRIPT} pass now"
    cd /app
    exec node dist/${SCRIPT_NAME}.js
fi

echo "[entrypoint] starting supercronic"
exec supercronic -prometheus-listen-address ":9746" /tmp/crontab.rendered
