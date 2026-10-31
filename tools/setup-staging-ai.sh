#!/usr/bin/env bash
# F0.3 — bootstrap the staging AI path, in the only order Cloudflare accepts.
#
# The two staging scripts bind each other:
#
#   admission-gk-staging  --SKY_AI----->  sky-ai-staging        (service binding)
#   sky-ai-staging        --AI_STATE--->  admission-gk-staging  (Durable Object)
#
# Cloudflare refuses each binding while its target is not ready, so on a fresh
# provision neither script can be deployed first:
#
#   * a service binding needs the target script to exist          (code 10143)
#   * a DO binding needs the target to declare the class in a
#     migration                                                    (code 10061)
#
# Both errors were hit for real on 2026-10-31: deploying sky-ai-staging first
# gave 10061, and deploying admission-gk-staging first gave 10143. This script
# is the order that works, in three steps:
#
#   1. sky-ai-staging WITHOUT the AI_STATE binding   (nothing depends on it yet)
#   2. admission-gk-staging in full                  (SKY_AI now resolves; declares AiStateObject)
#   3. sky-ai-staging in full                        (AI_STATE now resolves)
#
# It is safe to run twice: step 1 is skipped once sky-ai-staging exists, and the
# last two deploys are idempotent. On a re-run only steps 2 and 3 happen.
#
# Run:
#   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... bash tools/setup-staging-ai.sh
set -euo pipefail

ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-abb783e456e51a5d338419de93d5e576}"
export CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID"
export WRANGLER_SEND_METRICS=false

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ -z "${CLOUDFLARE_API_KEY:-}" ]; then
  echo "setup-staging-ai: set CLOUDFLARE_API_TOKEN (or CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL)." >&2
  exit 2
fi

WRANGLER="npx --yes wrangler@4.35.0"

echo "==> 1/4 sky-ai-staging without AI_STATE (breaks the circular binding)"
# Strip the AI_STATE durable-object binding for the first deploy. Only the
# binding is removed; the script, KV and flags namespace are all real.
BOOT_CONFIG="sky-ai/wrangler.staging.bootstrap.toml"
node -e '
const fs = require("fs");
const src = fs.readFileSync("sky-ai/wrangler.staging.toml", "utf8");
// Drop the AI_STATE binding block (comment line + 3 TOML lines).
const out = src.replace(
  /\n# The staging Durable Object[\s\S]*?script_name = "admission-gk-staging"\n/,
  "\n# AI_STATE is added by the final deploy in tools/setup-staging-ai.sh.\n"
);
if (out.includes("class_name = \"AiStateObject\"")) {
  console.error("bootstrap: could not strip the AI_STATE binding");
  process.exit(1);
}
fs.writeFileSync(process.argv[1], out);
' "$BOOT_CONFIG"
node scripts/check-staging-isolation.mjs "$BOOT_CONFIG"
( cd sky-ai && $WRANGLER deploy --config wrangler.staging.bootstrap.toml )
rm -f "$BOOT_CONFIG"

echo "==> 2/4 admission-gk-staging (declares AiStateObject, binds sky-ai-staging)"
node scripts/check-staging-isolation.mjs wrangler.staging.toml
$WRANGLER deploy --config wrangler.staging.toml

echo "==> 3/4 sky-ai-staging in full (AI_STATE now resolves)"
node scripts/check-staging-isolation.mjs sky-ai/wrangler.staging.toml
( cd sky-ai && $WRANGLER deploy --config wrangler.staging.toml )

echo "==> 4/4 the internal key staging forwards with"
# admission-gk-staging signs its forward to sky-ai-staging with
# `x-sky-internal`, read from PUB_KV `secret:sky-internal`. Production has one
# (the owner created it); staging's namespace is separate and starts empty, so
# without this the identity routes silently fall back to admission-gk-staging
# and a staging test would never exercise the twin. Generated here, staging
# only — it is never copied from production and never leaves this namespace.
PUB_KV_ID="2827bff9b9974101a305102e1fbd1214"
existing=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Auth-Email: ${CLOUDFLARE_EMAIL:-}" -H "X-Auth-Key: ${CLOUDFLARE_API_KEY:-}" \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/storage/kv/namespaces/$PUB_KV_ID/values/secret:sky-internal")
if [ "$existing" = "200" ]; then
  echo "    internal key already present; left as is"
else
  STAGING_INTERNAL_KEY=$(head -c 48 /dev/urandom | base64 | tr -d '\n=' | head -c 64)
  curl -s -X PUT \
    -H "X-Auth-Email: ${CLOUDFLARE_EMAIL:-}" -H "X-Auth-Key: ${CLOUDFLARE_API_KEY:-}" \
    -H "Content-Type: text/plain" --data-binary "$STAGING_INTERNAL_KEY" \
    "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/storage/kv/namespaces/$PUB_KV_ID/values/secret:sky-internal" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const ok=JSON.parse(s).success;console.log(ok?"    staging internal key written":"    FAILED to write the internal key");process.exit(ok?0:1)})'
fi

echo
echo "Staging AI path is up. Verify:"
echo "  curl -s https://sky-ai-staging.<subdomain>.workers.dev/health"
echo "  curl -s https://admission-gk-staging.<subdomain>.workers.dev/api/ai/sky-health"
echo "  curl -s https://admission-gk-staging.<subdomain>.workers.dev/api/ai/sky-flags   # x-sky-ai header proves the twin answered"
