#!/usr/bin/env bash
# One unattended acquire -> analyze -> derive -> upload transaction.
set -uo pipefail

ROOT=$(cd "$(dirname "$0")" && pwd)
export DATA_BG_ROOT="$ROOT"
CONFIG="$ROOT/config.env"
if [ ! -f "$CONFIG" ]; then
  echo "missing $CONFIG — copy config.env.example and fill it in" >&2
  exit 2
fi
set -a
# shellcheck disable=SC1090
. "$CONFIG"
set +a
export PATH="${NEWS_EXTRA_PATH:-/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin}:$ROOT/news/scripts/bin:${PATH:-}"

DRY=0
case ${1:-} in
  "") ;;
  --dry-run) DRY=1 ;;
  *) echo "usage: $0 [--dry-run]" >&2; exit 2 ;;
esac
if [ "$DRY" -eq 0 ] && grep -q 'REPLACE_ME' "$CONFIG"; then
  echo "config.env still contains REPLACE_ME placeholders" >&2
  exit 2
fi

VAR_DIR="$ROOT/var"
REPORT_DIR="$VAR_DIR/reports"
LOCK_DIR="$VAR_DIR/hourly.lock"
mkdir -p "$REPORT_DIR"
LOCK_ACQUIRED=0

release_lock() {
  if [ "$LOCK_ACQUIRED" -eq 1 ] && [ -f "$LOCK_DIR/pid" ] && \
      [ "$(cat "$LOCK_DIR/pid" 2>/dev/null)" = "$$" ]; then
    rm -f "$LOCK_DIR/pid"
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
}

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    printf '%s\n' "$$" > "$LOCK_DIR/pid"
    LOCK_ACQUIRED=1
    return 0
  fi
  owner=$(cat "$LOCK_DIR/pid" 2>/dev/null || true)
  case "$owner" in *[!0-9]*|"") owner="" ;; esac
  if [ -n "$owner" ] && kill -0 "$owner" 2>/dev/null; then
    printf '{"mode":"hourly","skipped":"already_running","owner_pid":%s}\n' "$owner"
    return 1
  fi
  rm -f "$LOCK_DIR/pid"
  rmdir "$LOCK_DIR" 2>/dev/null || true
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    printf '%s\n' "$$" > "$LOCK_DIR/pid"
    LOCK_ACQUIRED=1
    return 0
  fi
  echo '{"mode":"hourly","skipped":"already_running","owner_pid":null}'
  return 1
}

if ! acquire_lock; then exit 0; fi
trap 'release_lock; exit 130' HUP INT TERM

if ! python3 "$ROOT/verify_bundle.py" --quiet; then
  release_lock
  exit 2
fi

RUN_ID="$(date -u +%Y-%m-%dT%H%M%SZ)-$$"
PIPELINE_STDOUT="$REPORT_DIR/$RUN_ID.pipeline.stdout"
UPLOAD_STDOUT="$REPORT_DIR/$RUN_ID.upload.json"
COMBINED="$REPORT_DIR/$RUN_ID.json"

ARGS=(
  --limit "${NEWS_HOURLY_ANALYZE_LIMIT:-100}"
  --workers "${NEWS_LLM_WORKERS:-4}"
  --schema-retries "${NEWS_LLM_SCHEMA_RETRIES:-1}"
  --articles-per-source "${NEWS_ARTICLES_PER_SOURCE:-20}"
  --browser-timeout "${NEWS_BROWSER_TIMEOUT:-600}"
  --stage-timeout "${NEWS_STAGE_TIMEOUT:-7200}"
  --run-id "$RUN_ID"
)
if [ "${NEWS_SKIP_BROWSER:-0}" = "1" ]; then ARGS+=(--skip-browser); fi
if [ "$DRY" -eq 1 ]; then ARGS+=(--dry-run); fi

if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -s bash "$ROOT/news/scripts/run_nightly.sh" "${ARGS[@]}" \
    > "$PIPELINE_STDOUT"
else
  bash "$ROOT/news/scripts/run_nightly.sh" "${ARGS[@]}" > "$PIPELINE_STDOUT"
fi
PIPELINE_CODE=$?
cat "$PIPELINE_STDOUT"

PIPELINE_REPORT="$ROOT/news/data/_nightly/$RUN_ID.json"
if [ ! -f "$PIPELINE_REPORT" ]; then PIPELINE_REPORT=""; fi

UPLOAD_ARGS=()
if [ -n "$PIPELINE_REPORT" ]; then
  UPLOAD_ARGS+=(--report "$PIPELINE_REPORT" --expected-run-id "$RUN_ID")
else
  UPLOAD_ARGS+=(--archive-only)
fi
if [ "$DRY" -eq 1 ]; then UPLOAD_ARGS+=(--dry-run); fi
python3 "$ROOT/upload_to_gcs.py" "${UPLOAD_ARGS[@]}" > "$UPLOAD_STDOUT"
UPLOAD_CODE=$?
cat "$UPLOAD_STDOUT"

RUN_ID="$RUN_ID" PIPELINE_CODE="$PIPELINE_CODE" UPLOAD_CODE="$UPLOAD_CODE" \
PIPELINE_REPORT="$PIPELINE_REPORT" PIPELINE_STDOUT="$PIPELINE_STDOUT" \
UPLOAD_STDOUT="$UPLOAD_STDOUT" COMBINED="$COMBINED" python3 -c '
import json, os
upload = None
try:
    upload = json.loads(open(os.environ["UPLOAD_STDOUT"], encoding="utf-8").read())
except Exception as exc:
    upload = {"error": f"unreadable upload result: {exc}"}
result = {
    "mode": "news_hourly",
    "run_id": os.environ["RUN_ID"],
    "pipeline_exit": int(os.environ["PIPELINE_CODE"]),
    "pipeline_report": os.environ["PIPELINE_REPORT"] or None,
    "pipeline_stdout": os.environ["PIPELINE_STDOUT"],
    "upload_exit": int(os.environ["UPLOAD_CODE"]),
    "upload": upload,
}
with open(os.environ["COMBINED"], "w", encoding="utf-8") as fh:
    json.dump(result, fh, ensure_ascii=False, indent=1)
print(json.dumps(result, ensure_ascii=False))
'
REPORT_CODE=$?
release_lock
if [ "$REPORT_CODE" -ne 0 ]; then exit 2; fi
if [ "$PIPELINE_CODE" -ne 0 ] || [ "$UPLOAD_CODE" -ne 0 ]; then exit 1; fi
exit 0
