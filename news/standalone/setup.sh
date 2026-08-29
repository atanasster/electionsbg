#!/usr/bin/env bash
# One-time standalone-machine setup. It never installs system packages.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")" && pwd)
cd "$ROOT"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1 ($2)" >&2
    exit 2
  }
}
need python3 "install Python 3.10+ (Homebrew python is suitable)"
need node "install Node.js 20+"
need npm "installed with Node.js"
need gsutil "install the Google Cloud CLI and authenticate this machine"

python3 -c 'import sys; assert sys.version_info >= (3, 10), "Python 3.10+ required"'
node -e 'const [major]=process.versions.node.split(".").map(Number); if (major < 20) process.exit(2)' || {
  echo "Node.js 20+ required" >&2
  exit 2
}
python3 verify_bundle.py

if [ ! -f config.env ]; then
  cp config.env.example config.env
  chmod 600 config.env
  echo "created config.env — fill OPENROUTER_API_KEY and the three GCS URIs"
else
  chmod 600 config.env
fi

npm install --omit=dev
npx playwright install chromium
mkdir -p var/reports news/app-data data/news/mentions
echo "setup complete; run ./run_hourly.sh --dry-run, then ./install_cron.sh"
