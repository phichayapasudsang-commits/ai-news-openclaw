// Quick structural check for docker-compose.yml (no YAML lib needed).
const fs = require("fs");
const txt = fs.readFileSync("docker-compose.yml", "utf8");
const checks = {
  hasName:           /^name:\s+ai-news-digest/m.test(txt),
  hasDigest:         /^\s{2}digest:/m.test(txt),
  hasDigestOnce:     /digest-once:/m.test(txt),
  hasEnvFile:        /env_file:\s*\n\s+-\s+\.env/m.test(txt),
  hasCronProfile:    /profiles:\s*\n\s+-\s+cron/m.test(txt),
  hasOneshotProfile: /profiles:\s*\n\s+-\s+oneshot/m.test(txt),
  hasVolumes:        /-\s+\.\/logs:\/app\/logs/.test(txt),
  hasBuildCtx:       /context:\s*\.\s*\n\s+dockerfile:\s+Dockerfile/m.test(txt),
  digestCron:        /DIGEST_CRON:\s+"0 3 \* \* 1-5"/m.test(txt),
  tzBangkok:         /TZ:\s+"Asia\/Bangkok"/m.test(txt),
};
let ok = true;
for (const [k, v] of Object.entries(checks)) {
  console.log((v ? "OK " : "FAIL") + " " + k);
  if (!v) ok = false;
}
console.log(ok ? "\n[compose] structural check: OK" : "\n[compose] structural check: FAILED");
