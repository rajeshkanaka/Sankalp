#!/bin/bash
# One-command local demo. Compatible with the Bash shipped with macOS.
set -euo pipefail
cd "$(dirname "$0")"

for argument in "$@"; do
  case "$argument" in
    --help|-h)
      cat <<'HELP'
Usage: ./setup.sh [--no-open] [--reset-demo]

Prepare and run Sankalpa locally: pinned Node/npm, dependencies, Docker
backend, migrations, demo data when new, production build, browser and inbox.
One-time prerequisites: Git, fnm and Docker Desktop (no hosted account needed).
Existing data is preserved. Ctrl-C stops the app; the database keeps its data.

  --no-open     Print URLs without opening browser tabs.
  --reset-demo  Replace marked Maya/Arun practice data with the M3 sample.
                Save, sync and sign out of old demo tabs first.
HELP
      exit 0 ;;
    --no-open|--reset-demo) ;;
    *) printf 'Unknown option: %s\nRun ./setup.sh --help\n' "$argument" >&2; exit 2 ;;
  esac
done

for executable in git fnm docker; do
  if ! command -v "$executable" >/dev/null 2>&1; then
    printf 'Missing %s. Install the one-time prerequisites in README.md, then rerun ./setup.sh.\n' "$executable" >&2
    exit 1
  fi
done

eval "$(fnm env --shell bash)"
node_version="$(tr -d '[:space:]' < .node-version)"
if ! fnm use "$node_version" >/dev/null 2>&1; then
  printf 'Preparing Node %s (one-time download)…\n' "$node_version"
  fnm install "$node_version"
  fnm use "$node_version"
fi
npm_version="$(node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).engines.npm")"
if [ "$(npm --version)" != "$npm_version" ]; then
  printf 'Preparing npm %s in the selected fnm Node installation…\n' "$npm_version"
  npm install --global "npm@$npm_version"
fi
exec node scripts/setup-demo.mjs "$@"
