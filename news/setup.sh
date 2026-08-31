#!/usr/bin/env bash
# One-time setup after copying this news/ directory to a standalone machine.
set -euo pipefail

NEWS_ROOT=$(cd "$(dirname "$0")" && pwd)
cd "$NEWS_ROOT"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1 ($2)" >&2
    exit 2
  }
}
need python3 "install Python 3.10+"
need node "install Node.js 22+"
need npm "installed with Node.js"
need gcloud "installed with the Google Cloud CLI"
need gsutil "install the Google Cloud CLI"

python3 -c 'import sys; assert sys.version_info >= (3, 10), "Python 3.10+ required"'
node -e 'const n=Number(process.versions.node.split(".")[0]); process.exit(n >= 22 ? 0 : 2)' || {
  echo "Node.js 22+ required" >&2
  exit 2
}

for name in api model upload pipeline evals; do
  if [ ! -f ".env.$name" ]; then
    cp ".env.$name.example" ".env.$name"
    echo "created .env.$name"
  fi
  chmod 600 ".env.$name"
done
mkdir -p app-data mentions var/reports credentials
npm install --omit=dev
npx playwright install chromium
python3 verify_install.py

echo "setup complete"
echo "1. edit .env.api, .env.model, .env.upload, .env.pipeline and .env.evals"
echo "2. add the separate GCS and news-eval credential JSON files"
echo "   (when enabling evals, build ../news-functions and keep its credential distinct)"
echo "3. run ./run_hourly.sh --dry-run"
echo "4. run ./install_cron.sh"
