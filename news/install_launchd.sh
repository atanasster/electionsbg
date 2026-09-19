#!/usr/bin/env bash
# Install/remove the copied news folder's hourly job as a macOS LaunchAgent.
# Prefer this over install_cron.sh on a Mac — see standalone/install_launchd.sh.
set -euo pipefail

NEWS_ROOT=$(cd "$(dirname "$0")" && pwd)
exec /bin/bash "$NEWS_ROOT/standalone/install_launchd.sh" --root "$NEWS_ROOT" "$@"
