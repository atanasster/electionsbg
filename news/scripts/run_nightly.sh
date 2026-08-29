#!/usr/bin/env bash
# The nightly run, end to end, on a machine nobody is watching.
#
# ⚠️ THE REPORT IS THE PRODUCT. Nobody is at the keyboard at 03:00, so a stage
# that quietly did nothing and a stage that worked must be distinguishable
# from the output alone. Every stage emits one JSON object; this script
# collects them into one line and writes it to news/data/_nightly/<date>.json.
#
# ⚠️ IT DOES NOT `set -e`. A failure in one stage must not abandon the
# others: a model server that is down should still leave the corpus harvested
# and the bundles rebuilt, and the report must say which stage failed rather
# than ending at the first one. Each stage records its own exit code instead.
#
# Usage:  news/scripts/run_nightly.sh [--limit N] [--model NAME]
#          [--workers N] [--schema-retries 0|1] [--run-id ID] [--dry-run]
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 2
ROOT=$(pwd)
export PATH="$ROOT/news/scripts/bin:$PATH"
if [ ! -x "$ROOT/news/scripts/bin/timeout" ]; then
  echo '{"mode":"nightly","error":"missing_timeout_wrapper"}'
  exit 2
fi
LIMIT=40
if [ -n "${OPENROUTER_API_KEY:-}" ]; then
  DEFAULT_MODEL=z-ai/glm-5.3-flash
  export NEWS_LLM_URL=${NEWS_LLM_URL:-https://openrouter.ai/api/v1/chat/completions}
  export NEWS_LLM_ALLOW_REMOTE=${NEWS_LLM_ALLOW_REMOTE:-1}
  export NEWS_LLM_REASONING_EFFORT=${NEWS_LLM_REASONING_EFFORT:-low}
else
  DEFAULT_MODEL=local-model
fi
MODEL=${NEWS_LLM_MODEL:-$DEFAULT_MODEL}
MAX_TOKENS=${NEWS_LLM_MAX_TOKENS:-2048}
TEMPERATURE=${NEWS_LLM_TEMPERATURE:-0.2}
WORKERS=${NEWS_LLM_WORKERS:-4}
SCHEMA_RETRIES=${NEWS_LLM_SCHEMA_RETRIES:-1}
ARTICLES_PER_SOURCE=${NEWS_ARTICLES_PER_SOURCE:-20}
BROWSER_TIMEOUT=${NEWS_BROWSER_TIMEOUT:-600}
STAGE_TIMEOUT=${NEWS_STAGE_TIMEOUT:-7200}
SKIP_BROWSER=0
DRY=0
REQUESTED_RUN_ID=""
require_uint() {
  case ${2:-} in
    *[!0-9]*|"") echo "$1 must be a non-negative integer" >&2; exit 2 ;;
  esac
}
while [ $# -gt 0 ]; do
  case $1 in
    --limit)
      [ "$#" -ge 2 ] || { echo "--limit requires N" >&2; exit 2; }
      case $2 in
        *[!0-9]*|"") echo "--limit must be a non-negative integer" >&2; exit 2 ;;
      esac
      LIMIT=$2; shift 2
      ;;
    --model)
      [ "$#" -ge 2 ] || { echo "--model requires NAME" >&2; exit 2; }
      [ -n "$2" ] || { echo "--model requires NAME" >&2; exit 2; }
      MODEL=$2; shift 2
      ;;
    --workers)
      [ "$#" -ge 2 ] || { echo "--workers requires N" >&2; exit 2; }
      require_uint "--workers" "$2"
      [ "$2" -ge 1 ] || { echo "--workers must be at least 1" >&2; exit 2; }
      WORKERS=$2; shift 2
      ;;
    --schema-retries)
      [ "$#" -ge 2 ] || { echo "--schema-retries requires 0 or 1" >&2; exit 2; }
      case $2 in
        0|1) SCHEMA_RETRIES=$2 ;;
        *) echo "--schema-retries must be 0 or 1" >&2; exit 2 ;;
      esac
      shift 2
      ;;
    --articles-per-source)
      [ "$#" -ge 2 ] || { echo "--articles-per-source requires N" >&2; exit 2; }
      require_uint "--articles-per-source" "$2"
      ARTICLES_PER_SOURCE=$2; shift 2
      ;;
    --browser-timeout)
      [ "$#" -ge 2 ] || { echo "--browser-timeout requires SECONDS" >&2; exit 2; }
      require_uint "--browser-timeout" "$2"
      BROWSER_TIMEOUT=$2; shift 2
      ;;
    --skip-browser) SKIP_BROWSER=1; shift ;;
    --stage-timeout)
      [ "$#" -ge 2 ] || { echo "--stage-timeout requires SECONDS" >&2; exit 2; }
      require_uint "--stage-timeout" "$2"
      STAGE_TIMEOUT=$2; shift 2
      ;;
    --run-id)
      [ "$#" -ge 2 ] || { echo "--run-id requires ID" >&2; exit 2; }
      case $2 in
        ""|*[!A-Za-z0-9._-]*)
          echo "--run-id must contain only letters, digits, dot, underscore, or dash" >&2
          exit 2
          ;;
      esac
      REQUESTED_RUN_ID=$2; shift 2
      ;;
    --dry-run) DRY=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
require_uint "NEWS_ARTICLES_PER_SOURCE" "$ARTICLES_PER_SOURCE"
require_uint "NEWS_BROWSER_TIMEOUT" "$BROWSER_TIMEOUT"
require_uint "NEWS_STAGE_TIMEOUT" "$STAGE_TIMEOUT"
require_uint "NEWS_LLM_WORKERS" "$WORKERS"
require_uint "NEWS_LLM_MAX_TOKENS" "$MAX_TOKENS"
[ "$WORKERS" -ge 1 ] || { echo "NEWS_LLM_WORKERS must be at least 1" >&2; exit 2; }
[ "$MAX_TOKENS" -ge 1 ] || { echo "NEWS_LLM_MAX_TOKENS must be at least 1" >&2; exit 2; }
if ! NEWS_TEMPERATURE="$TEMPERATURE" python3 -c '
import os
try:
    value = float(os.environ["NEWS_TEMPERATURE"])
except ValueError:
    raise SystemExit(1)
raise SystemExit(0 if 0 <= value <= 2 else 1)
'; then
  echo "NEWS_LLM_TEMPERATURE must be a number between 0 and 2" >&2
  exit 2
fi
case $SCHEMA_RETRIES in
  0|1) ;;
  *) echo "NEWS_LLM_SCHEMA_RETRIES must be 0 or 1" >&2; exit 2 ;;
esac

STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
RUN_ID=${REQUESTED_RUN_ID:-"$(date -u +%Y-%m-%dT%H%M%SZ)-$$"}
OUT_DIR="$ROOT/news/data/_nightly"
mkdir -p "$OUT_DIR"
LOCK_DIR="$OUT_DIR/pipeline.lock"
LOCK_ACQUIRED=0

release_lock() {
  if [ "$LOCK_ACQUIRED" -eq 1 ] && [ -f "$LOCK_DIR/pid" ] && \
      [ "$(cat "$LOCK_DIR/pid" 2>/dev/null)" = "$$" ]; then
    rm -f "$LOCK_DIR/pid"
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
}

finish() {
  code=$1
  release_lock
  exit "$code"
}

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    printf '%s\n' "$$" > "$LOCK_DIR/pid"
    LOCK_ACQUIRED=1
    return 0
  fi
  owner=$(cat "$LOCK_DIR/pid" 2>/dev/null || true)
  case "$owner" in
    *[!0-9]*|"") owner="" ;;
  esac
  if [ -n "$owner" ] && kill -0 "$owner" 2>/dev/null; then
    printf '{"mode":"nightly","skipped":"already_running","owner_pid":%s}\n' "$owner"
    return 1
  fi
  # The owner is absent or dead. Remove only the two exact lock paths, then
  # contend once more; another hourly invocation may win this race.
  rm -f "$LOCK_DIR/pid"
  rmdir "$LOCK_DIR" 2>/dev/null || true
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    printf '%s\n' "$$" > "$LOCK_DIR/pid"
    LOCK_ACQUIRED=1
    return 0
  fi
  echo '{"mode":"nightly","skipped":"already_running","owner_pid":null}'
  return 1
}

if ! acquire_lock; then
  exit 0
fi
# An EXIT trap is deliberately avoided: command substitutions in stage()
# inherit it on the target bash and could release the parent's lock early.
trap 'release_lock; exit 130' HUP INT TERM

REPORT="$OUT_DIR/$RUN_ID.json"
DIRECT_SUMMARY="$OUT_DIR/$RUN_ID.direct.jsonl"
BROWSER_SUMMARY="$OUT_DIR/$RUN_ID.browser.jsonl"
for artifact in "$REPORT" "$DIRECT_SUMMARY" "$BROWSER_SUMMARY" \
                "$OUT_DIR/$RUN_ID.stages.jsonl"; do
  if [ -e "$artifact" ]; then
    echo "run artifact already exists: $artifact" >&2
    finish 2
  fi
done
STAGES_EXPECTED=9
REPORT_INTEGRITY_FAILED=0
LAST_STAGE_NAME=""
LAST_STAGE_CODE=0
# ⚠️⚠️ NO `trap … EXIT` HERE, AND THAT IS NOT AN OVERSIGHT. In bash an EXIT
# trap fires when a COMMAND-SUBSTITUTION SUBSHELL exits, not only when the
# script does — so `trap 'rm -f "$STAGES"' EXIT` combined with
# `out=$("$@" 2>&1)` deleted the stages file after every single stage. Every
# stage ran, every stage printed its line, and the report came out saying
# `stages_run: 0`. A report that says nothing ran, after a run in which
# everything ran, is precisely the failure this script exists to prevent.
#
# The file lives beside the report instead and is worth keeping: it is the
# per-stage stream, and the report is the fold of it.
STAGES="$OUT_DIR/$RUN_ID.stages.jsonl"
: > "$STAGES"

# ⚠️ NO HEREDOC INSIDE THIS FUNCTION. The first version used
# `python3 - args >> "$STAGES" <<'PY'` and the heredoc silently never ran —
# every stage executed, every stage printed its line to stderr, and the
# report came out with `stages_run: 0`. A report that says nothing ran, after
# a run in which everything ran, is the exact failure this script exists to
# prevent. The payload now goes in on stdin through a plain pipe.
stage() {
  local name=$1; shift
  local started out code secs payload
  started=$(date +%s)
  out=$(timeout "$STAGE_TIMEOUT" "$@" 2>&1)
  code=$?
  secs=$(( $(date +%s) - started ))
  # The tail, and only if it parses. A stage that printed a traceback would
  # otherwise put a raw multi-line string into the report and make the whole
  # file unparseable — turning a stage failure into a report failure.
  payload=$(printf '%s' "$out" | tail -1)
  if ! printf '%s' "$payload" | python3 -c 'import json,sys; value=json.load(sys.stdin); sys.exit(0 if isinstance(value, dict) else 1)' 2>/dev/null; then
    # ⚠️ `errors="replace"`, because a stage's output is NOT guaranteed to be
    # UTF-8. A binary blob on stderr — a segfaulting model server, a mangled
    # locale — otherwise reaches the .jsonl as raw bytes and kills the report
    # reader for EVERY stage, turning one stage's failure into a run with no
    # report at all.
    payload=$(printf '%s' "$out" | tail -3 | python3 -c \
      'import json,sys; print(json.dumps({"unparsed": sys.stdin.buffer.read().decode("utf-8", "replace")[:600]}))')
    # A stage that claims success but emits no machine-readable result cannot
    # be trusted by the report or an unattended operator.
    if [ "$code" -eq 0 ]; then code=2; fi
  fi
  if ! printf '%s' "$payload" | NAME="$name" CODE="$code" SECS="$secs" python3 -c '
import json, os, sys
print(json.dumps({"stage": os.environ["NAME"], "exit": int(os.environ["CODE"]),
                  "seconds": int(os.environ["SECS"]),
                  "result": json.load(sys.stdin)}, ensure_ascii=False))
' >> "$STAGES"; then
    REPORT_INTEGRITY_FAILED=1
    echo "  [$name] could not record its stage result" >&2
  fi
  LAST_STAGE_NAME="$name"
  LAST_STAGE_CODE=$code
  echo "  [$name] exit=$code $(( $(date +%s) - started ))s" >&2
}

echo "== nightly $STAMP ==" >&2

# ── 1. Acquire the corpus ──────────────────────────────────────────────────
# A model outage must never suppress acquisition. Fresh source material is
# useful on its own, and the next healthy analysis run will pick it up.
if [ "$DRY" = 1 ]; then
  stage acquire_direct python3 -c \
    'import json; print(json.dumps({"skipped": "dry_run"}))'
  stage acquire_browser python3 -c \
    'import json; print(json.dumps({"skipped": "dry_run"}))'
else
  stage acquire_direct bash news/scripts/save_all_direct.sh "$ARTICLES_PER_SOURCE" \
    "$DIRECT_SUMMARY"
  if [ "$SKIP_BROWSER" = 1 ]; then
    stage acquire_browser python3 -c \
      'import json; print(json.dumps({"skipped": "configured"}))'
  else
    stage acquire_browser bash news/scripts/save_all_browser.sh "$ARTICLES_PER_SOURCE" \
      "$BROWSER_SUMMARY" \
      "--timeout=$BROWSER_TIMEOUT"
  fi
fi

# ── 2. Is there a model at all? ────────────────────────────────────────────
# The probe gates analysis only; it deliberately comes after acquisition.
if [ "$DRY" = 1 ]; then
  stage probe_model python3 -c \
    'import json; print(json.dumps({"skipped": "dry_run"}))'
else
  stage probe_model python3 news/scripts/llm_client.py
fi
MODEL_PROBE_CODE=$LAST_STAGE_CODE

# ── 3. Prompt assets in step with the schema ───────────────────────────────
# ⚠️ A grammar that permits a label the validator rejects yields records that
# are perfectly formed and refused 100% of the time — which reads as a model
# problem and is not one.
if [ "$DRY" = 1 ]; then
  stage check_prompts python3 -c \
    'import json; print(json.dumps({"skipped": "dry_run"}))'
else
  stage check_prompts python3 news/scripts/build_prompts.py --check
fi

# ── 4. Gazetteer + dictionary pass inputs ──────────────────────────────────
# Deterministic, no model, so this stage never fails for LLM reasons.
if [ "$DRY" = 1 ]; then
  stage common_words python3 -c \
    'import json; print(json.dumps({"skipped": "dry_run"}))'
else
  stage common_words python3 news/scripts/build_gazetteer.py \
    --rebuild-common-words --json
fi

# ── 5. Judge ───────────────────────────────────────────────────────────────
if [ "$DRY" = 1 ]; then
  stage analyze python3 -c \
    'import json; print(json.dumps({"skipped": "dry_run"}))'
elif [ "$MODEL_PROBE_CODE" -ne 0 ]; then
  stage analyze python3 -c \
    'import json; print(json.dumps({"skipped": "model_unavailable"}))'
else
  stage analyze python3 news/scripts/analyze_local.py \
    --limit "$LIMIT" --model "$MODEL" --max-tokens "$MAX_TOKENS" \
    --temperature "$TEMPERATURE" --workers "$WORKERS" \
    --schema-retries "$SCHEMA_RETRIES"
fi

# ── 6. Review queue ────────────────────────────────────────────────────────
# ⚠️ A pipeline that knows what it does not know is worth more than one
# confidently wrong on a tenth of its political framing calls — and nobody is
# watching, so the queue has to arrive in the report rather than wait to be
# asked for.
if [ "$DRY" = 1 ]; then
  stage review_queue python3 -c \
    'import json; print(json.dumps({"skipped": "dry_run"}))'
else
  stage review_queue python3 news/scripts/review_routing.py --limit 0 --json
fi

# ── 7. Reciprocal index ────────────────────────────────────────────────────
if [ "$DRY" = 1 ]; then
  stage mention_index python3 -c \
    'import json; print(json.dumps({"skipped": "dry_run"}))'
else
  stage mention_index python3 news/scripts/build_mention_index.py --json
fi

# ── 8. App bundles ─────────────────────────────────────────────────────────
if [ "$DRY" = 1 ]; then
  stage bundles python3 -c \
    'import json; print(json.dumps({"skipped": "dry_run"}))'
else
  stage bundles python3 news/scripts/build_app_data.py --quiet --json
fi

# ── 9. Report ──────────────────────────────────────────────────────────────
# ⚠️ The stages come in by PATH, not on stdin. `python3 - < "$STAGES"
# <<'PYEOF'` applies both redirections and the LATER one wins — so the
# heredoc replaced the file as stdin, the reader saw the script text instead
# of the stages, and the report said `stages_run: 0` while a perfectly good
# stages file sat next to it.
STAMP="$STAMP" RUN_ID="$RUN_ID" REPORT="$REPORT" STAGES="$STAGES" \
DIRECT_SUMMARY="$DIRECT_SUMMARY" BROWSER_SUMMARY="$BROWSER_SUMMARY" python3 - <<'PYEOF'
import json, os
stamp, dest = os.environ["STAMP"], os.environ["REPORT"]
with open(os.environ["STAGES"], encoding="utf-8") as fh:
    stages = [json.loads(line) for line in fh if line.strip()]
failed = [s["stage"] for s in stages if s["exit"] != 0]
report = {
    "run_id": os.environ["RUN_ID"],
    "generated_at": stamp,
    "stages": stages,
    "failed_stages": failed,
    # ⚠️ Counts, never a bare "ok". „6 of 6 stages" and „ok" look the same
    # until one stage is silently missing from the list.
    "stages_run": len(stages),
    "stages_ok": len(stages) - len(failed),
}
# Bundling reports both corpus and analysis counts; copying the difference
# into the nightly result makes analysis debt visible without another scan.
bundle = next((s.get("result", {}) for s in stages
               if s.get("stage") == "bundles"), {})
bundle = bundle if isinstance(bundle, dict) else {}
total = bundle.get("total_articles")
analysed = bundle.get("analyzed_articles")
if isinstance(total, int) and isinstance(analysed, int):
    report["analysis_backlog"] = {
        "corpus_total": total,
        "analyzed_total": analysed,
        "pending_total": max(0, total - analysed),
    }
acquisition = {}
for stage_name, artifact_env in (("acquire_direct", "DIRECT_SUMMARY"),
                                 ("acquire_browser", "BROWSER_SUMMARY")):
    result = next((s.get("result", {}) for s in stages
                   if s.get("stage") == stage_name), {})
    alerts = result.get("alerts") if isinstance(result, dict) else []
    counts = {}
    if isinstance(alerts, list):
        for alert in alerts:
            kind = alert.get("alert") if isinstance(alert, dict) else None
            if kind:
                counts[kind] = counts.get(kind, 0) + 1
    acquisition[stage_name.removeprefix("acquire_")] = {
        "artifact": os.environ[artifact_env],
        "skipped": result.get("skipped") if isinstance(result, dict) else None,
        "alerts": counts,
    }
report["acquisition"] = acquisition
with open(dest, "w", encoding="utf-8") as fh:
    json.dump(report, fh, ensure_ascii=False, indent=1)
print(json.dumps({k: report[k] for k in
                  ("generated_at", "stages_run", "stages_ok", "failed_stages")},
                 ensure_ascii=False))
PYEOF
REPORT_CODE=$?
echo "  report → $REPORT" >&2

if [ "$(wc -l < "$STAGES")" -ne "$STAGES_EXPECTED" ]; then
  REPORT_INTEGRITY_FAILED=1
  echo "  stage report incomplete: expected $STAGES_EXPECTED records" >&2
fi

# ⚠️⚠️ THE EXIT STATUS COMES FROM THIS RUN, not from a file on disk. The first
# version re-read "$REPORT" to decide — so a run whose report step FAILED
# exited 0 off the STALE same-day report left by an earlier run, which is the
# quiet-night lie this whole script exists to prevent. `CODE=$?` was captured
# and never used, which is what hid it.
if [ "$REPORT_CODE" -ne 0 ]; then
  echo "  the report step itself failed (exit $REPORT_CODE)" >&2
  finish 2
fi
if [ "$REPORT_INTEGRITY_FAILED" -ne 0 ]; then
  finish 2
fi
if grep -q '"exit": [^0]' "$STAGES"; then
  finish 1
fi
finish 0
