#!/usr/bin/env bash
# Direct entry point when this entire news/ directory is copied to a machine.
set -euo pipefail

NEWS_DEPLOY_ROOT=$(cd "$(dirname "$0")" && pwd)
export NEWS_DEPLOY_ROOT
exec /bin/bash "$NEWS_DEPLOY_ROOT/standalone/run_hourly.sh" "$@"
