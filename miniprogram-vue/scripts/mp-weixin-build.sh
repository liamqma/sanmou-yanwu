#!/usr/bin/env bash
# mp-weixin-build.sh
# Injects UNI_APP_ID from .env into manifest.json before building/running
# the WeChat Mini Program target, then restores the placeholder afterwards.
#
# Usage (via package.json scripts):
#   bash scripts/mp-weixin-build.sh dev      → runs: uni -p mp-weixin
#   bash scripts/mp-weixin-build.sh build    → runs: uni build -p mp-weixin

set -e

MANIFEST="src/manifest.json"
PLACEHOLDER="WECHAT_APP_ID_PLACEHOLDER"
ENV_FILE=".env"

# ── Load UNI_APP_ID ──────────────────────────────────────────────────────────
# Priority: existing shell env → .env file
if [ -z "$UNI_APP_ID" ] && [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC2046
  export $(grep -v '^#' "$ENV_FILE" | grep 'UNI_APP_ID' | xargs)
fi

if [ -z "$UNI_APP_ID" ]; then
  echo "ERROR: UNI_APP_ID is not set. Add it to .env or export it before running." >&2
  exit 1
fi

echo "[mp-weixin] Using AppID: $UNI_APP_ID"

# ── Inject AppID into manifest.json ─────────────────────────────────────────
sed -i.bak "s/$PLACEHOLDER/$UNI_APP_ID/g" "$MANIFEST"

# ── Run uni command ──────────────────────────────────────────────────────────
MODE="${1:-build}"
if [ "$MODE" = "dev" ]; then
  # Use trap to restore on Ctrl-C during dev mode
  trap 'sed -i.bak "s/$UNI_APP_ID/$PLACEHOLDER/g" "$MANIFEST" && rm -f "${MANIFEST}.bak" && echo "[mp-weixin] Restored placeholder in manifest.json"' EXIT
  npx uni -p mp-weixin
else
  npx uni build -p mp-weixin
  # Restore placeholder after build
  sed -i.bak "s/$UNI_APP_ID/$PLACEHOLDER/g" "$MANIFEST"
fi

# ── Clean up backup file created by sed -i.bak ──────────────────────────────
rm -f "${MANIFEST}.bak"

echo "[mp-weixin] Done. manifest.json placeholder restored."
