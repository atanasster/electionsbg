#!/usr/bin/env bash
# One unattended acquire -> analyze -> derive -> upload transaction.
set -uo pipefail

SCRIPT_ROOT=$(cd "$(dirname "$0")" && pwd)
if [ -n "${NEWS_DEPLOY_ROOT:-}" ]; then
  NEWS_ROOT=$(cd "$NEWS_DEPLOY_ROOT" && pwd)
  ROOT=$(cd "$NEWS_ROOT/.." && pwd)
  OPERATIONS_ROOT="$NEWS_ROOT"
  CONFIG_FILES=(
    "$NEWS_ROOT/.env.api"
    "$NEWS_ROOT/.env.model"
    "$NEWS_ROOT/.env.upload"
    "$NEWS_ROOT/.env.pipeline"
  )
  VERIFY=(python3 "$NEWS_ROOT/verify_install.py" --quiet)
  PIPELINE="$NEWS_ROOT/scripts/run_nightly.sh"
  UPLOADER="$NEWS_ROOT/standalone/upload_to_gcs.py"
  export NEWS_MENTIONS_DIR="$NEWS_ROOT/mentions"
else
  ROOT="$SCRIPT_ROOT"
  NEWS_ROOT="$ROOT/news"
  OPERATIONS_ROOT="$ROOT"
  CONFIG_FILES=("$ROOT/config.env")
  VERIFY=(python3 "$ROOT/verify_bundle.py" --quiet)
  PIPELINE="$ROOT/news/scripts/run_nightly.sh"
  UPLOADER="$ROOT/upload_to_gcs.py"
fi
export DATA_BG_ROOT="$ROOT"
for config in "${CONFIG_FILES[@]}"; do
  if [ ! -f "$config" ]; then
    echo "missing $config — run setup.sh and fill in the environment files" >&2
    exit 2
  fi
  set -a
  # Configuration files are assignment-only. Fail immediately if a malformed
  # line is interpreted as a command; the pipeline itself deliberately runs
  # without errexit so it can report every stage.
  set -e
  # shellcheck disable=SC1090
  . "$config"
  set +e
  set +a
done
export PATH="${NEWS_EXTRA_PATH:-/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin}:$NEWS_ROOT/scripts/bin:${PATH:-}"

DRY=0
case ${1:-} in
  "") ;;
  --dry-run) DRY=1 ;;
  *) echo "usage: $0 [--dry-run]" >&2; exit 2 ;;
esac
if [ "$DRY" -eq 0 ] && grep -q 'REPLACE_ME' "${CONFIG_FILES[@]}"; then
  echo "environment files still contain REPLACE_ME placeholders" >&2
  exit 2
fi
VAR_DIR="$OPERATIONS_ROOT/var"
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

case ${NEWS_GCS_ACTIVATE_SERVICE_ACCOUNT:-0} in
  0) ;;
  1)
    if [ "$DRY" -eq 0 ]; then
      [ -f "${GOOGLE_APPLICATION_CREDENTIALS:-}" ] || {
        echo "GCS service-account JSON is missing: ${GOOGLE_APPLICATION_CREDENTIALS:-unset}" >&2
        release_lock
        exit 2
      }
      command -v gcloud >/dev/null 2>&1 || {
        echo "gcloud is required to activate the upload service account" >&2
        release_lock
        exit 2
      }
      if ! gcloud auth activate-service-account \
          --key-file="$GOOGLE_APPLICATION_CREDENTIALS" --quiet >/dev/null; then
        release_lock
        exit 2
      fi
    fi
    ;;
  *)
    echo "NEWS_GCS_ACTIVATE_SERVICE_ACCOUNT must be 0 or 1" >&2
    release_lock
    exit 2
    ;;
esac

if ! "${VERIFY[@]}"; then
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
  caffeinate -s bash "$PIPELINE" "${ARGS[@]}" \
    > "$PIPELINE_STDOUT"
else
  bash "$PIPELINE" "${ARGS[@]}" > "$PIPELINE_STDOUT"
fi
PIPELINE_CODE=$?
cat "$PIPELINE_STDOUT"

PIPELINE_REPORT="$NEWS_ROOT/data/_nightly/$RUN_ID.json"
if [ ! -f "$PIPELINE_REPORT" ]; then PIPELINE_REPORT=""; fi

UPLOAD_ARGS=()
if [ -n "$PIPELINE_REPORT" ]; then
  UPLOAD_ARGS+=(--report "$PIPELINE_REPORT" --expected-run-id "$RUN_ID")
else
  UPLOAD_ARGS+=(--archive-only)
fi
if [ "$DRY" -eq 1 ]; then UPLOAD_ARGS+=(--dry-run); fi
python3 "$UPLOADER" "${UPLOAD_ARGS[@]}" > "$UPLOAD_STDOUT"
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
