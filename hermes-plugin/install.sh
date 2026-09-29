#!/bin/bash
# Install (or update) the Workable window into the Hermes desktop app.
#
#   bash hermes-plugin/install.sh            # into ~/.hermes (where the desktop app loads plugins)
#   HERMES_HOME=~/.hermes-test bash hermes-plugin/install.sh
#
# Creates WORKABLE_EMBED_TOKEN in .env.local if it's missing and writes the same
# token into the installed plugin. Restart `npm run dev` after the first install.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOME_DIR="${HERMES_HOME:-$HOME/.hermes}"
ENV_FILE="$REPO/.env.local"
DEST="$HOME_DIR/desktop-plugins/workable"

token=$(grep -E '^WORKABLE_EMBED_TOKEN=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true)
if [ -z "$token" ]; then
  token=$(node -e "process.stdout.write(require('crypto').randomBytes(24).toString('base64url'))")
  printf '\n# Token the Hermes desktop window uses to reach Workable from its sandboxed frame\nWORKABLE_EMBED_TOKEN=%s\n' "$token" >> "$ENV_FILE"
  echo "Added WORKABLE_EMBED_TOKEN to .env.local (restart npm run dev)"
fi
grep -q '^NEXT_PUBLIC_WORKABLE_HERMES=true' "$ENV_FILE" 2>/dev/null || echo "Note: set NEXT_PUBLIC_WORKABLE_HERMES=true in .env.local so the Team map loads."

mkdir -p "$DEST"
sed "s/__WORKABLE_EMBED_TOKEN__/$token/" "$REPO/hermes-plugin/desktop/plugin.js" > "$DEST/plugin.js"
echo "Installed $DEST/plugin.js — Hermes picks it up within a few seconds (⌘K → Reload desktop plugins if not)."
