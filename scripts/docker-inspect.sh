#!/bin/sh
echo "=== /app/dist/ ==="
ls -la /app/dist/
echo ""
echo "=== sizes ==="
du -sh /app/node_modules /ms-playwright /app/dist
echo ""
echo "=== chromium executablePath ==="
node -e "console.log(require('playwright-core').chromium.executablePath())"
echo ""
echo "=== chromium binary exists? ==="
ls -la "$(node -e "console.log(require('playwright-core').chromium.executablePath())")" 2>&1 | head -3
echo ""
echo "=== supercronic version ==="
supercronic -version
echo ""
echo "=== tini version ==="
tini --version 2>&1 || echo "(tini reports version differently)"
echo ""
echo "=== render crontab + test ==="
DIGEST_CRON="0 3 * * 1-5" sh -c '
DIGEST_CRON="${DIGEST_CRON:-0 3 * * 1-5}"
sed "s|__DIGEST_CRON__|${DIGEST_CRON}|" /etc/crontab.digest > /tmp/crontab.rendered
cat /tmp/crontab.rendered
echo "---"
supercronic -test /tmp/crontab.rendered
'
